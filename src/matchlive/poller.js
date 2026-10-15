/**
 * matchlive/poller.js
 * O loop único do /matchlive: a cada 5s, uma consulta por partida acompanhada
 * (não importa em quantos canais), e o resultado espalhado pelos canais.
 *
 * Um loop só, e não um por canal, por dois motivos: a carga no MySQL do
 * Daycore cresce com as partidas e não com os canais, e o limite de edição do
 * Discord (~5 por 5s por canal) já pede essa cadência de qualquer jeito.
 *
 * O estado de cada track mora no SQLite (db/matchlive.js) e é salvo depois de
 * cada tick, então um restart retoma de onde parou. O que fica só em memória
 * é descartável: as linhas da mensagem de log aberta (depois de um restart o
 * próximo log abre mensagem nova) e o backoff de cada partida.
 *
 * Dependências injetadas para o teste rodar sem Discord nem banco; `_fontes`
 * existe só para o teste trocar a fonte depois de criado.
 */

const { logError } = require('../lib/logger');
const { diff } = require('./diff');

const INTERVALO_MS = 5000;
const INATIVIDADE_MS = 3 * 60 * 60 * 1000;
const AVISO_DB_MS = 5 * 60 * 1000;
const MAX_LINHAS_LOG = 15;
const BACKOFF_MAX_MS = 60000;

// Unknown Channel, Missing Access, Missing Permissions: o canal não serve mais.
const CANAL_PERDIDO = new Set([10003, 50001, 50013]);
const MENSAGEM_SUMIU = 10008;

function criarPoller({ client, db, fontes, render, strings, siteUrl, agora = Date.now, intervaloMs = INTERVALO_MS }) {
  const falhas = new Map();        // `${server}|${matchId}` → { desde, backoff, proxima, avisou }
  const linhasDoLog = new Map();   // logMessageId → string[]
  let timer = null;
  let rodando = false;

  async function postar(canal, payload) { return canal.send(payload); }

  async function editarOuPostar(canal, msgId, payload) {
    try {
      await canal.messages.edit(msgId, payload);
      return msgId;
    } catch (err) {
      if (err?.code !== MENSAGEM_SUMIU) throw err;
      return (await postar(canal, payload)).id;
    }
  }

  // O estado é salvo a cada ação que deu certo (no finally), e não só no fim:
  // se um envio falha no meio (429, rede), o que já foi postado fica registrado
  // e o próximo tick não reposta o log nem o início de jogo.
  async function processarTrack(track, snap, jogosTerminados) {
    const s = strings(track.guildId);
    const canal = await client.channels.fetch(track.channelId);
    const eventos = snap.events.filter(e => e.id > track.lastEventId);
    const { acoes, lastEventId: novoLastEventId } = diff(track, { ...snap, events: eventos });

    const estado = {
      lastEventId: track.lastEventId,
      logMessageId: track.logMessageId,
      logLines: track.logLines,
      gameMessages: { ...track.gameMessages },
      lastActivityAt: track.lastActivityAt,
    };
    let removido = false;
    const remover = () => { removido = true; db.removeTrack(track.channelId, track.server, track.matchId); };

    try {
      const novasLinhas = acoes.filter(a => a.tipo === 'log').map(a => render.linhaDeLog(a.evento, s));

      if (novasLinhas.length) {
        const atuais = estado.logMessageId ? linhasDoLog.get(estado.logMessageId) : null;
        if (atuais && estado.logLines + novasLinhas.length <= MAX_LINHAS_LOG) {
          const todas = [...atuais, ...novasLinhas];
          estado.logMessageId = await editarOuPostar(canal, estado.logMessageId, { embeds: [render.embedLog(todas, snap.match, s)] });
          linhasDoLog.set(estado.logMessageId, todas);
          estado.logLines = todas.length;
        } else {
          const m = await postar(canal, { embeds: [render.embedLog(novasLinhas, snap.match, s)] });
          estado.logMessageId = m.id;
          linhasDoLog.set(m.id, novasLinhas);
          estado.logLines = novasLinhas.length;
        }
        estado.lastActivityAt = agora();
      }
      // Só avança o cursor de eventos depois que as linhas foram de fato postadas.
      estado.lastEventId = novoLastEventId;

      for (const acao of acoes) {
        if (acao.tipo === 'gameStart') {
          const m = await postar(canal, { embeds: [render.embedJogoInicio(acao.game, snap.match, s)] });
          estado.gameMessages[acao.game.id] = m.id;
          estado.lastActivityAt = agora();
        } else if (acao.tipo === 'gameEnd' || acao.tipo === 'gameAbort') {
          const embed = acao.tipo === 'gameEnd'
            ? render.embedJogoFim(acao.game, snap.match, jogosTerminados, s)
            : render.embedJogoAbortado(acao.game, snap.match, s);
          const id = await editarOuPostar(canal, estado.gameMessages[acao.game.id], { embeds: [embed] });
          estado.gameMessages[acao.game.id] = `done:${id}`;
          estado.lastActivityAt = agora();
        } else if (acao.tipo === 'matchEnd') {
          await postar(canal, { embeds: [render.embedFim(snap.match, siteUrl(track.server, track.matchId), s)] });
          remover();
          return;
        }
      }

      if (!acoes.length && agora() - estado.lastActivityAt >= INATIVIDADE_MS) {
        await postar(canal, { content: s.matchlive_idle_stop(track.matchId) });
        remover();
      }
    } finally {
      if (!removido) db.saveTrackState(track.channelId, track.server, track.matchId, estado);
    }
  }

  async function falhou(chave, grupo, err) {
    const f = falhas.get(chave) ?? { desde: agora(), backoff: 0, avisou: false };
    f.backoff = Math.min(f.backoff ? f.backoff * 2 : INTERVALO_MS, BACKOFF_MAX_MS);
    f.proxima = agora() + f.backoff;
    falhas.set(chave, f);
    logError('matchlive:fonte', err);
    if (!f.avisou && agora() - f.desde >= AVISO_DB_MS) {
      f.avisou = true;
      for (const tr of grupo) {
        try { await (await client.channels.fetch(tr.channelId)).send({ content: strings(tr.guildId).matchlive_db_down }); }
        catch (e) { logError('matchlive', e); }
      }
    }
  }

  async function tick() {
    if (rodando) return;
    rodando = true;
    try {
      const grupos = new Map();
      for (const tr of db.listTracks()) {
        const chave = `${tr.server}|${tr.matchId}`;
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(tr);
      }

      for (const [chave, grupo] of grupos) {
        const f = falhas.get(chave);
        if (f && f.proxima > agora()) continue;

        const { server, matchId } = grupo[0];
        const fonte = api._fontes[server];
        if (!fonte) continue;

        let snap;
        try {
          snap = await fonte.snapshot(matchId, Math.min(...grupo.map(tr => tr.lastEventId)));
        } catch (err) {
          await falhou(chave, grupo, err);
          continue;
        }
        falhas.delete(chave);

        if (snap === null) {
          for (const tr of grupo) db.removeTrack(tr.channelId, tr.server, tr.matchId);
          continue;
        }

        const jogosTerminados = snap.games.filter(g => g.endedAt != null);
        for (const tr of grupo) {
          try {
            await processarTrack(tr, snap, jogosTerminados);
          } catch (err) {
            logError('matchlive', err);
            if (CANAL_PERDIDO.has(err?.code)) db.removeTrack(tr.channelId, tr.server, tr.matchId);
          }
        }
      }
    } finally {
      rodando = false;
    }
  }

  const api = {
    _fontes: fontes,
    tick,
    start() { if (!timer) timer = setInterval(() => { tick().catch(e => logError('matchlive', e)); }, intervaloMs); },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}

module.exports = { criarPoller, INTERVALO_MS, INATIVIDADE_MS, AVISO_DB_MS, MAX_LINHAS_LOG, BACKOFF_MAX_MS };

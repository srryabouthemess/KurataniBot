/**
 * scoreStore.js
 * Guardar os scores que o bot já buscou, sem atrasar resposta nenhuma.
 *
 * ── O contrato ────────────────────────────────────────────────────────────────
 *   - Nada aqui fica no caminho da resposta. O `record` só empurra uma
 *     referência para uma lista: O(1), síncrono, sem I/O. Normalizar e gravar
 *     acontecem no flush.
 *   - Falha de gravação NUNCA chega a quem chamou: vai para o log (uma vez por
 *     causa) e para as métricas. Guardar score é acessório; o comando responde
 *     igual sem isto.
 *
 * ── Quando o flush roda ───────────────────────────────────────────────────────
 * O osuClient chama `record` ANTES da resposta, porque é lá que o score passa.
 * Quem sabe quando a resposta saiu é o despacho (bot/dispatch.js): ele roda o
 * `execute` dentro de `escopo()`, e o `execute` só termina depois do
 * `editReply`. O que foi registrado dentro do escopo espera numa lista própria
 * e só vai para a fila quando ele termina — com o flush num `setImmediate`,
 * depois da resposta.
 *
 * Fora de escopo (o 🔄 da paginação roda no coletor, fora do contexto do
 * comando; e qualquer rotina de fundo), o score vai direto para a fila, e o
 * flush é agendado com atraso de `ATRASO_MS` (`setTimeout` com `unref`, para
 * não segurar o processo vivo). Ali a ordem "depois da resposta" não é
 * garantida ao pé da letra; o que é garantido é que o flush não está no
 * caminho de nenhum `await` da resposta.
 *
 * O escopo FECHA quando o comando termina. Uma promise que o comando deixou
 * correndo (o `warmNext` da paginação, por exemplo) e registre depois disso
 * cai no caminho de fora de escopo, em vez de ir para uma lista que ninguém
 * mais esvazia.
 *
 * ── Custo, medido ─────────────────────────────────────────────────────────────
 * Com 300 mil linhas no scores.db: 1,8ms (p50) por lote de 100 upserts, com
 * picos de ~23ms quando coincide com checkpoint do WAL. Daí o lote de 100 com
 * `setImmediate` entre um e outro: uma varredura de 3000 scores do /topscores
 * não para o event loop de uma vez.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const config = require('./config');
const metrics = require('./lib/metrics');
const { logErrorOnce } = require('./lib/logger');
const { canonicalMods, modsToBits, stripImpliedDT } = require('./mods');

/** Atraso do flush de quem registra fora de escopo. */
const ATRASO_MS = 5000;

/** Scores por transação. */
const LOTE = 100;

/**
 * Teto da fila, em scores. Com o banco travado ou o disco cheio a fila não
 * esvazia, e sem teto ela cresceria até derrubar o processo por memória — por
 * um recurso acessório. O excedente é descartado e contado.
 */
const MAX_FILA = 5000;

/** A poda desce até esta fração do teto, para não rodar a cada lote novo. */
const PODA_ALVO = 0.9;

/**
 * Linhas por DELETE da poda. Medido: 500 de uma vez levaram 41ms (os três
 * índices com chave aleatória custam); de 100 em 100, 2,5ms (p50) por tick.
 */
const PODA_LOTE = 100;

let _opts = {
  atrasoMs: ATRASO_MS,
  lote:     LOTE,
  maxFila:  MAX_FILA,
  maxRows:  null, // null = config.scoreStore.maxRows, lido na hora
  banco:    null, // null = o db de verdade, carregado na primeira gravação
};

const _als = new AsyncLocalStorage();

/** [{ scores, ctx }] — referências, ainda não normalizadas. */
let _fila = [];
let _naFila = 0;
let _timer = null;
let _imediato = false;
let _gravando = false;
let _podando = false;
/** server → linhas; `null` até a primeira poda precisar. */
let _contagem = null;

/**
 * O banco, carregado só na primeira gravação.
 *
 * Adiado de propósito: o despacho e o osuClient importam este módulo, e um
 * require do db no topo abriria o banco em todo teste que só carrega um
 * comando. E se o banco não abrir, quem sofre é a gravação, não o import.
 */
function banco() {
  return _opts.banco ?? require('./db');
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Registra scores para gravar depois. Nunca lança, nunca espera.
 *
 * @param {Array<object>} scores como o adaptador os devolveu
 * @param {object}   ctx
 * @param {string}   ctx.server     chave do registro, com variante (`daycore_rx`)
 * @param {number}   [ctx.userId]   dono dos scores; sem ele, vale o `user_id` do score
 * @param {string}   [ctx.username] nick, quando já se sabe sem pedir à rede
 * @param {Function} [ctx.adaptar]  score cru → forma normalizada (ver os adaptadores)
 * @param {boolean}  [ctx.varredura] veio da varredura do /topscores: conta à parte
 */
function record(scores, ctx) {
  try {
    if (!Array.isArray(scores) || scores.length === 0 || !ctx?.server) return;

    const escopo = _als.getStore();
    if (escopo && !escopo.fechado) {
      escopo.itens.push({ scores, ctx });
      return;
    }

    enfileirar({ scores, ctx });
    agendarComAtraso();
  } catch (error) {
    logErrorOnce('scoreStore', error);
  }
}

/**
 * Roda `fn` num escopo: o que for registrado dentro dele só vai para a fila
 * quando `fn` terminar — dê certo ou lance —, e o flush sai no tick seguinte.
 *
 * Devolve o que `fn` devolver e relança o que ela lançar, sem embrulho: o
 * despacho trata o resultado exatamente como antes.
 */
async function escopo(fn) {
  const store = { itens: [], fechado: false };
  try {
    return await _als.run(store, fn);
  } finally {
    store.fechado = true;
    try {
      for (const item of store.itens) enfileirar(item);
      if (_fila.length > 0) agendarJa();
    } catch (error) {
      logErrorOnce('scoreStore', error);
    }
  }
}

function enfileirar(item) {
  const n = item.scores.length;
  if (_naFila + n > _opts.maxFila) {
    metrics.count('scoreStore.filaCheia', n);
    return;
  }
  _fila.push(item);
  _naFila += n;
}

function agendarJa() {
  if (_imediato) return;
  _imediato = true;
  setImmediate(() => {
    _imediato = false;
    flush();
  });
}

function agendarComAtraso() {
  if (_timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    flush();
  }, _opts.atrasoMs);
  _timer.unref?.();
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function inteiro(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function epochMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 'osu' | 'taiko' | 'fruits' | 'mania' → 0..3. O bot hoje só trata o osu!. */
const RULESETS = { osu: 0, taiko: 1, fruits: 2, mania: 3 };

/** md5 que preste, ou null — nunca um texto qualquer na coluna. */
const md5 = (v) => (typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v) ? v.toLowerCase() : null);

/**
 * Score (na forma normalizada dos adaptadores) → linha das colunas, ou null.
 *
 * Sai null o que não serve: play que não passou (decisão de desenho — ver
 * db/schema.js) e score sem id ou sem dono, que não têm chave.
 *
 * O md5 só é lido de `map_md5`, e só os adaptadores em que a API comprovadamente
 * manda o preenchem (ver a lista em bancho.py `normalize.js`). Nos outros ele
 * fica NULL, em vez de vir de um campo que nunca foi conferido.
 *
 * Mods: o NC sem o DT que o bitmask do stable arrasta junto (ver
 * stripImpliedDT), senão a mesma play seria 'DT,NC' no bancho.py e 'NC' no
 * oficial.
 */
function linhaDe(bruto, ctx) {
  const s = ctx.adaptar ? ctx.adaptar(bruto) : bruto;
  if (!s || typeof s !== 'object') return null;
  if (s.passed === false || s.rank === 'F') return null;

  const scoreId = inteiro(s.score_id ?? s.id);
  const userId  = inteiro(ctx.userId ?? s.user_id);
  if (scoreId === null || userId === null) return null;

  const mods = stripImpliedDT(Array.isArray(s.mods) ? s.mods : []);
  const st = s.statistics ?? {};

  return {
    server:      String(ctx.server),
    score_id:    scoreId,
    user_id:     userId,
    ruleset:     RULESETS[s.mode] ?? 0,
    map_id:      inteiro(s.beatmap?.id),
    map_md5:     md5(s.map_md5),
    mods:        canonicalMods(mods),
    mods_bits:   modsToBits(mods),
    pp:          numero(s.pp),
    accuracy:    numero(s.accuracy),
    max_combo:   inteiro(s.max_combo),
    total_score: inteiro(s.score),
    n300:        inteiro(st.count_300),
    n100:        inteiro(st.count_100),
    n50:         inteiro(st.count_50),
    nmiss:       inteiro(st.count_miss),
    rank:        typeof s.rank === 'string' ? s.rank : null,
    played_at:   epochMs(s.created_at),
    // Não é coluna: vai para score_players.
    _username:   ctx.username ?? s.user?.username ?? null,
  };
}

// ─── Gravação ─────────────────────────────────────────────────────────────────

/** Tira até `max` scores da fila, sem partir um `record` ao meio além do necessário. */
function tirarLote(max) {
  const lote = [];
  while (_fila.length > 0 && lote.length < max) {
    const item = _fila[0];
    const cabe = max - lote.length;
    const pedaco = item.scores.length <= cabe ? item.scores : item.scores.slice(0, cabe);

    for (const score of pedaco) lote.push({ score, ctx: item.ctx });
    _naFila -= pedaco.length;

    if (pedaco.length === item.scores.length) _fila.shift();
    else item.scores = item.scores.slice(cabe);
  }
  return lote;
}

/** Um lote numa transação por origem. Falha aqui fica aqui. */
function gravarLote(lote) {
  const porOrigem = { normal: [], varredura: [] };
  const jogadores = new Map();
  let descartados = 0;

  for (const { score, ctx } of lote) {
    let linha = null;
    try {
      linha = linhaDe(score, ctx);
    } catch {
      // Um score estranho que quebre o adaptador não leva o lote junto.
    }
    if (!linha) { descartados++; continue; }

    const { _username, ...colunas } = linha;
    porOrigem[ctx.varredura ? 'varredura' : 'normal'].push(colunas);

    const chave = `${colunas.server}:${colunas.user_id}`;
    if (_username || !jogadores.has(chave)) {
      jogadores.set(chave, { server: colunas.server, userId: colunas.user_id, username: _username });
    }
  }
  if (descartados > 0) metrics.count('scoreStore.descartados', descartados);

  const db = banco();
  if (!db.scoresDisponivel()) {
    metrics.count('scoreStore.desligado', lote.length - descartados);
    return;
  }

  // Os nicks vão na transação da primeira origem com linhas; basta uma vez.
  let jogadoresPendentes = [...jogadores.values()];

  for (const [origem, linhas] of Object.entries(porOrigem)) {
    if (linhas.length === 0) continue;
    const varredura = origem === 'varredura';
    const { novos, existentes, novosPorServidor } =
      db.gravarScores(linhas, { varredura, jogadores: jogadoresPendentes });
    jogadoresPendentes = [];

    // No formato do `metrics.cache`, para o /diag mostrar a taxa: "hit" é score
    // que já estava guardado. A varredura tem nome próprio — os mesmos 3000
    // scores a cada rodada fariam a taxa do uso normal parecer 100%.
    const nome = varredura ? 'scoreStoreVarredura' : 'scoreStore';
    if (existentes) metrics.count(`cache.${nome}.hit`, existentes);
    if (novos)      metrics.count(`cache.${nome}.miss`, novos);

    if (_contagem) {
      for (const [server, n] of novosPorServidor) _contagem.set(server, (_contagem.get(server) ?? 0) + n);
    }
  }
}

/**
 * Esvazia a fila em lotes, um por tick. Reentrante por construção: com uma
 * rodada em curso, a chamada nova só volta — a rodada pega o que chegou.
 */
function flush() {
  if (_gravando) return;
  _gravando = true;
  passo();
}

function passo() {
  try {
    const lote = tirarLote(_opts.lote);
    if (lote.length > 0) gravarLote(lote);
  } catch (error) {
    metrics.count('scoreStore.falhas');
    logErrorOnce('scoreStore', error);
  }

  if (_fila.length > 0) {
    setImmediate(passo);
    return;
  }
  _gravando = false;
  podarSePreciso();
}

/**
 * Grava tudo o que estiver na fila AGORA, de uma vez. Só para o shutdown: ali
 * o que resta na fila se perderia, e travar o event loop não atrasa ninguém.
 */
function flushAgora() {
  clearTimeout(_timer);
  _timer = null;
  while (_fila.length > 0) {
    try {
      gravarLote(tirarLote(_opts.lote));
    } catch (error) {
      metrics.count('scoreStore.falhas');
      logErrorOnce('scoreStore', error);
    }
  }
}

// ─── Poda ─────────────────────────────────────────────────────────────────────

const maxRows = () => _opts.maxRows ?? config.scoreStore.maxRows;

/**
 * Passou do teto: desce até `PODA_ALVO` do teto, um pedaço por tick.
 *
 * Sai sempre do servidor com MAIS linhas, e dele o que menos serve a um
 * ranking (sem pp, depois o menor pp). Podar por idade comeria justamente o
 * topo antigo que um ranking quer; podar igual de todos apagaria o servidor
 * pequeno inteiro para o grande continuar com o que sobra.
 *
 * A contagem por servidor é lida do banco uma vez por processo (uma varredura
 * do índice da chave: 14ms com 300 mil linhas) e mantida em memória a partir
 * daí.
 */
function podarSePreciso() {
  if (_podando) return;
  try {
    const db = banco();
    if (!db.scoresDisponivel()) return;
    _contagem ??= db.contarScoresPorServidor();
  } catch (error) {
    logErrorOnce('scoreStore:poda', error);
    return;
  }

  const total = () => [..._contagem.values()].reduce((a, b) => a + b, 0);
  if (total() <= maxRows()) return;

  const alvo = Math.floor(maxRows() * PODA_ALVO);
  _podando = true;

  const pedaco = () => {
    try {
      const excesso = total() - alvo;
      if (excesso <= 0) { _podando = false; return; }

      const [server] = [..._contagem].sort((a, b) => b[1] - a[1])[0];
      const apagados = banco().podarScoresDoServidor(server, Math.min(PODA_LOTE, excesso));
      _contagem.set(server, Math.max(0, _contagem.get(server) - apagados));
      metrics.count('scoreStore.podados', apagados);

      if (apagados === 0) {
        // A contagem em memória se desviou do banco (outra conexão, apagamento à
        // mão): relê na próxima vez em vez de insistir.
        _contagem = null;
        _podando = false;
        return;
      }
      setImmediate(pedaco);
    } catch (error) {
      logErrorOnce('scoreStore:poda', error);
      _podando = false;
    }
  };
  pedaco();
}

// ─── Privacidade ──────────────────────────────────────────────────────────────

/**
 * Apaga tudo o que se guardou de um jogador num servidor (ver docs/PRIVACY.md).
 *
 * Sem comando: é para quem mantém o bot atender um pedido. O que ainda estiver
 * na fila daquele jogador sai junto, senão o flush seguinte o gravaria de novo.
 *
 * @returns {number} scores apagados
 */
function forgetPlayer(server, userId) {
  const id = Number(userId);
  _fila = _fila.filter(({ ctx }) => !(ctx.server === server && Number(ctx.userId) === id));
  _naFila = _fila.reduce((n, item) => n + item.scores.length, 0);

  const apagados = banco().esquecerJogador(server, id);
  // Relê na próxima poda, em vez de manter a conta à mão.
  _contagem = null;
  return apagados;
}

// ─── Teste ────────────────────────────────────────────────────────────────────

const _paraTeste = {
  configurar(opts) { _opts = { ..._opts, ...opts }; },
  reset() {
    clearTimeout(_timer);
    _timer = null;
    _fila = [];
    _naFila = 0;
    _imediato = false;
    _gravando = false;
    _podando = false;
    _contagem = null;
    _opts = { atrasoMs: ATRASO_MS, lote: LOTE, maxFila: MAX_FILA, maxRows: null, banco: null };
  },
  naFila: () => _naFila,
  linhaDe,
};

module.exports = {
  record, escopo, flushAgora, forgetPlayer,
  ATRASO_MS, LOTE, MAX_FILA,
  _paraTeste,
};

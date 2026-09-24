/**
 * commands/admin/scorewipe/mapwipe.js
 * A tela do lote: todas as plays do jogador num mapa, confirmadas e publicadas
 * de uma vez pelo canal `mapwipe`.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const daycore = require('../../../daycoreAdmin');
const { registrarAcao } = require('../../../adminLog');
const { descrever } = require('./format');
const { CONFIRM_MS, LISTA_MAX_CHARS } = require('./limits');

/**
 * A segunda confirmação, e a publicação do lote.
 *
 * Mora fora do `execute` porque é a terceira tela de um comando que já tinha
 * duas; deixá-la inline faria a função principal passar de duzentas linhas e
 * misturar três fluxos no mesmo escopo.
 *
 * O clique no botão do lote NÃO publica: ele traz para cá, e é só o confirmar
 * daqui que manda. A ação é maior que a de um score e ganha confirmação
 * própria, com as plays na tela.
 */
async function apagarOMapa(interaction, { s, staff, target, modeLabel, modeNum, reason, alvo, doMapa }) {
  const mapLabel  = alvo.mapLabel ?? s.scorewipe_map_unknown;
  const confirmId = `mapwipe_ok_${interaction.id}`;
  const cancelId  = `mapwipe_no_${interaction.id}`;

  // A lista é cortada por ITEM inteiro, e não por caractere. Um corte no meio
  // de uma linha entrega uma tela que parece completa — com o número certo no
  // cabeçalho — e esconde que faltou coisa; quem confere uma ação destrutiva
  // precisa saber que está vendo só uma parte, daí o "e mais N" no fim.
  const linhas = [];
  let usado = 0;
  for (const item of doMapa) {
    const linha = descrever(item, s);
    // O +2 é o '\n\n' que junta esta linha à anterior.
    if (usado + linha.length + 2 > LISTA_MAX_CHARS) break;
    linhas.push(linha);
    usado += linha.length + 2;
  }
  const omitidas = doMapa.length - linhas.length;
  const lista = linhas.join('\n\n') + (omitidas > 0 ? `\n\n${s.mapwipe_more(omitidas)}` : '');

  const aviso = new EmbedBuilder()
    .setColor(0xff6666)
    .setTitle(s.mapwipe_confirm_title)
    .setDescription(
      s.mapwipe_confirm_body(target.name, target.id, modeLabel, mapLabel, doMapa.length) + '\n\n' +
      lista + '\n\n' +
      s.mapwipe_includes_failed + '\n\n' +
      s.scorewipe_reversible,
    )
    .setFooter({ text: s.nom_actor(staff.osuName) });

  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(s.mapwipe_button_confirm(doMapa.length)).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel(s.wipe_button_cancel).setStyle(ButtonStyle.Secondary),
  );

  const prompt = await interaction.editReply({ embeds: [aviso], components: [botoes] });

  let clique;
  try {
    clique = await prompt.awaitMessageComponent({
      // O filtro prende os ids DESTA tela, e não só o autor. Entre o
      // `deferUpdate` do clique que trouxe até aqui e o coletor abaixo ficar de
      // pé há uma janela de centenas de milissegundos em que o cliente ainda
      // desenha os botões da tela anterior — e botão do Discord não desabilita
      // ao ser clicado. Um duplo clique no botão do lote, que é comportamento
      // humano normal, chegaria aqui carregando o customId de lá; sem esta
      // linha, o coletor o aceitaria e a segunda confirmação seria atravessada
      // sem ninguém tê-la lido.
      filter: i => i.user.id === interaction.user.id &&
                   (i.customId === confirmId || i.customId === cancelId),
      time: CONFIRM_MS,
    });
  } catch {
    return interaction.editReply({ content: s.scorewipe_expired, embeds: [], components: [] });
  }

  await clique.deferUpdate().catch(() => {});

  // Checagem POSITIVA, e não `!== cancelId`: só o confirmar desta tela publica.
  // Qualquer outra coisa que chegue até aqui cai no cancelamento, porque numa
  // tela destrutiva o comportamento seguro por omissão é não fazer nada.
  if (clique.customId !== confirmId) {
    return interaction.editReply({ content: s.scorewipe_cancelled, embeds: [], components: [] });
  }

  // A contagem e a lista de ids abaixo foram lidas na montagem da tela anterior,
  // até 60 segundos atrás; o `wipeMapScores` apaga por md5 e modo no servidor,
  // então uma play enviada nesse intervalo é apagada junto sem aparecer no
  // `detail`. É inerente ao desenho — a alternativa seria reler a lista aqui e
  // confirmar um número diferente do que o staff acabou de aprovar — e o
  // `verifyMapScoresWiped` continua conferindo o mapa inteiro, não esta lista.
  await daycore.wipeMapScores(target.id, alvo.md5, modeNum, {
    osuId:       staff.osuId,
    discordId:   interaction.user.id,
    discordName: interaction.user.username,
  }, reason);

  const confirmado = await daycore.verifyMapScoresWiped(target.id, alvo.md5, modeNum);

  const registrado = registrarAcao('mapwipe', {
    action: 'mapwipe',
    target: target.id,
    detail: `${target.name} | ${modeLabel} | ${doMapa.length} scores em ${mapLabel} | ${reason} | ` +
            `${doMapa.map(item => item.id).join(',')} | ` +
            (confirmado ? 'confirmado' : 'NAO confirmado'),
    actorDiscordId: interaction.user.id,
    actorOsuId: staff.osuId,
    actorOsuName: staff.osuName,
  });

  const resultado = new EmbedBuilder()
    .setColor(confirmado && registrado ? 0x99ff99 : 0xffcc66)
    .setTitle(s.mapwipe_done_title)
    .setDescription(
      s.mapwipe_done_body(target.name, target.id, doMapa.length, mapLabel) + '\n\n' +
      (confirmado ? s.mapwipe_confirmed : s.mapwipe_unconfirmed) +
      (registrado ? '' : '\n\n' + s.admin_log_failed),
    )
    .setFooter({ text: s.nom_actor(staff.osuName) });

  return interaction.editReply({ embeds: [resultado], components: [] });
}

module.exports = { apagarOMapa };

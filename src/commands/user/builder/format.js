/**
 * commands/user/builder/format.js
 * A play de exemplo da prévia do /builder, e o embed dela.
 *
 * A prévia não busca nada: a play é fixa e os números que o /recent buscaria
 * (pp, estrelas, metadados e atributos do mapa) já vêm prontos em `DADOS`, no
 * formato que o `dadosSingle` devolve. Quem desenha é o mesmo `montarSingle`
 * do /recent, então o que a pessoa vê aqui é o que vai ver lá — e cada clique
 * no menu responde na hora, sem rede nem cálculo de pp.
 *
 * O exemplo tem TODOS os pedaços preenchidos (PB, choke com o pp do FC, miss,
 * linha do mapa, capa): um pedaço que já viesse vazio não mudaria nada ao ser
 * desligado, e a pessoa não saberia o que ele faz.
 */

const playEmbed = require('../../../embeds/play');

/** Duas horas antes de `agora`: o "há 2 horas" do exemplo. */
const DUAS_HORAS = 2 * 60 * 60 * 1000;

/**
 * A play de exemplo.
 *
 * Os dois totais vêm preenchidos para a prévia seguir o formato de score que a
 * pessoa escolheu no /link default, como o /recent dela faria.
 *
 * @param {number} agora       epoch ms de quando o /builder foi aberto
 * @param {string|null} capa   imagem da miniatura (a do próprio bot)
 */
function amostra(agora, capa) {
  return {
    pp: 287.45,
    accuracy: 0.9648,
    rank: 'A',
    mods: ['HD', 'DT'],
    max_combo: 812,
    passed: true,
    score: 8123456,
    score_classic: 8123456,
    score_standardised: 812345,
    created_at: new Date(agora - DUAS_HORAS).toISOString(),
    statistics: { count_300: 1180, count_100: 42, count_50: 3, count_miss: 4 },
    beatmap: { id: 0, version: 'Insane', max_combo: 1024 },
    beatmapset: { id: 0, title: 'Example Song', artist: 'Artist', covers: { list: capa } },
  };
}

/** O que o `dadosSingle` traria para a play de exemplo. */
const DADOS = Object.freeze({
  pp:       { proprio: 287.45, fc: 341.9 },
  estrelas: '6.42',
  meta:     { status: 'Ranked', creator: 'Mapper', length: 150 },
  attrs:    { cs: 4, ar: 10.33, od: 9.75, hp: 6, clockRate: 1.5, bpm: 270, objects: 1229 },
});

/** Posição do exemplo no "Top #N pessoal". */
const PB = 12;

/** O jogador do cabeçalho da prévia. */
const JOGADOR = Object.freeze({
  id: 0,
  username: 'player',
  country_code: 'BR',
  statistics: { pp: 7654.32, global_rank: 4321, country_rank: 210 },
});

/**
 * O bloco da prévia: o mesmo objeto que o `single` devolve ao /recent.
 *
 * @param {Set<string>} layout  as chaves ligadas (ver embedLayout.js)
 * @param {object} opts
 * @param {object} opts.s
 * @param {string|null} [opts.scoreFormat]
 * @param {number} opts.agora
 * @param {string|null} [opts.capa]
 */
function previa(layout, { s, scoreFormat = null, agora, capa = null, mode }) {
  return playEmbed.montarSingle(amostra(agora, capa), DADOS, {
    mode, s, scoreFormat, personalBest: PB, layout,
  });
}

module.exports = { previa, amostra, DADOS, PB, JOGADOR };

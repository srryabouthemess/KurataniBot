/**
 * A tabela de pp do /map, e a mecânica em que ela é calculada.
 *
 * ── O que já aconteceu ────────────────────────────────────────────────────────
 * O /map pedia a mecânica clássica escrevendo `{ lazer: false }`, que era o nome
 * da opção quando o comando foi escrito. Depois a mecânica virou o mod CL e o
 * `simulatePP` passou a ler `{ classic: true }` — mas só o /simulate foi
 * atualizado. O nome velho continuou no /map sem dar erro nenhum, porque uma
 * chave que ninguém desestrutura não reclama: ela é ignorada, o padrão do
 * servidor oficial (lazer) valeu, e os dois comandos passaram a responder
 * números diferentes para o MESMO mapa, mods e acertos.
 *
 * Nada na tela denunciava. Sai um pp plausível — 765.23pp no lugar de 751.58pp
 * (FREEDOM DiVE +HR a 98%), que é diferença de sobra para uma pessoa comparar
 * com o /simulate e concluir que um dos dois está quebrado, e pouca demais para
 * qualquer teste de forma perceber.
 *
 * ── Por que o teste é escrito assim ───────────────────────────────────────────
 * Cravar `opts.classic === true` não teria pego a regressão original: o defeito
 * não foi escrever o valor errado, foi escrever um NOME que o `simulatePP` não
 * lê. Um teste que repete o nome ao lado do comando concorda com ele por
 * construção.
 *
 * Então a asserção é sobre o EFEITO: pega o objeto de opções que o comando
 * entregou, passa pelo `simulatePP` de verdade e olha os mods que chegam ao
 * motor. Se o CL não estiver lá, o cálculo é de lazer — não importa como a
 * opção se chame hoje.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// O db precisa de casa própria ANTES de qualquer require de src: o i18n e o
// mapContext gravam nele, e sem isto o teste mexeria no bot.db real.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-map-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;

// ─── Os dois mocks ────────────────────────────────────────────────────────────

/**
 * O motor, trocado por um que só anota o que recebeu.
 *
 * Entra no lugar do `lazerWorker` e não do `pp`, de propósito: é justamente o
 * `pp` que este teste quer exercitar de verdade — ele é quem decide os mods.
 */
const chamadasMotor = [];
const lazerPath = require.resolve('../src/lazerWorker');
require.cache[lazerPath] = {
  id: lazerPath, filename: lazerPath, loaded: true,
  exports: {
    calcular: async (op, mapId, args) => {
      chamadasMotor.push({ op, mapId, args });
      return { pp: 100, stars: 5, maxCombo: 500 };
    },
    close: () => {},
    stats: () => ({}),
  },
};

const pp = require('../src/pp');
const { modAcronym } = require('../src/mods');

/**
 * O osuClient, trocado por um que anota as chamadas de `simulatePP`.
 *
 * O que é PARSE continua sendo o de verdade (`parseModTokens`,
 * `parseBeatmapId`): um mock deles diria que "HR" virou o que o teste quisesse,
 * e é exatamente a lista de mods que interessa aqui.
 */
const simulacoes = [];
const clientPath = require.resolve('../src/osuClient');
const real = { mods: require('../src/mods'), servers: require('../src/servers') };
const osuMock = {
  DEFAULT_MODE:     real.servers.defaultKey(),
  parseModTokens:   real.mods.parseModTokens,
  parseBeatmapId:   (input) => (/^\d+$/.test(String(input)) ? Number(input) : null),
  getModeLabel:     (mode) => real.servers.label(mode),
  getMapUrl:        (mapId) => `https://osu.ppy.sh/b/${mapId}`,
  getBeatmap:       async (id) => ({
    id, version: 'FOUR DIMENSIONS', total_length: 247, status: 'ranked', max_combo: 3245,
    difficulty_rating: 7.8, beatmapset_id: 39804,
    beatmapset: { id: 39804, title: 'FREEDOM DiVE', artist: 'xi', creator: 'Nakagawa-Kanon', covers: {} },
  }),
  getAdjustedStars: async () => '8.33',
  getMapAttrs:      async () => ({
    cs: 4, ar: 10, od: 10, hp: 6, clockRate: 1, bpm: 222.22, objects: 1983,
  }),
  simulatePP: async (beatmapId, mods, hits, mode, opts) => {
    simulacoes.push({ beatmapId, mods, hits, mode, opts });
    return { pp: 100, stars: 5, maxCombo: 3245 };
  },
};
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: osuMock,
};

const mapCmd      = require('../src/commands/map');
const simulateCmd = require('../src/commands/simulate');

test.after(() => {
  try { require('../src/db').close(); } catch { /* já fechado */ }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ─── A interação ──────────────────────────────────────────────────────────────

/** Uma interação de slash com as opções que o teste quiser. */
function fakeInteraction(opcoes) {
  const respostas = [];
  return {
    respostas,
    user:    { id: '1' },
    guildId: '2',
    options: {
      getString:  (nome) => opcoes[nome] ?? null,
      getInteger: (nome) => opcoes[nome] ?? null,
    },
    reply:      async (p) => { respostas.push(p); },
    deferReply: async () => {},
    editReply:  async (p) => { respostas.push(p); },
  };
}

test.beforeEach(() => { simulacoes.length = 0; chamadasMotor.length = 0; });

// ─── Os testes ────────────────────────────────────────────────────────────────

test('a tabela do /map é calculada em mecânica clássica', async () => {
  await mapCmd.execute(fakeInteraction({ map: '129891', mods: 'HR' }));

  assert.equal(simulacoes.length, 5, 'deveria pedir uma linha por acurácia');

  // O caminho inteiro, e não o nome da opção: as opções que o comando montou
  // entram no simulatePP de verdade, e o que se olha é o que sai do outro lado.
  for (const { beatmapId, mods, hits, mode, opts } of simulacoes) {
    chamadasMotor.length = 0;
    await pp.simulatePP(beatmapId, mods, hits, mode, opts);

    const enviados = chamadasMotor[0]?.args?.mods ?? [];
    assert.ok(
      enviados.some(m => modAcronym(m) === 'CL'),
      `sem CL o motor calcula em lazer; foi ${JSON.stringify(enviados)}`,
    );
  }
});

test('o /map e o /simulate pedem a MESMA mecânica', async () => {
  // É o que o comentário do /map afirma ("pelo mesmo motivo do /simulate"), e é
  // a promessa que o rename quebrou: os dois comandos respondem sobre o mesmo
  // mapa, e discordar entre si é o defeito visível.
  await mapCmd.execute(fakeInteraction({ map: '129891', mods: 'HR' }));
  const doMap = simulacoes[0];

  simulacoes.length = 0;
  await simulateCmd.execute(fakeInteraction({ map: '129891', mods: 'HR', n100: 30 }));
  const doSimulate = simulacoes[0];

  const mecanica = async ({ beatmapId, mods, hits, mode, opts }) => {
    chamadasMotor.length = 0;
    await pp.simulatePP(beatmapId, mods, hits, mode, opts);
    return real.mods.canonicalMods(chamadasMotor[0].args.mods);
  };

  assert.equal(
    await mecanica(doMap), await mecanica(doSimulate),
    'os dois comandos deveriam chegar ao motor com os mesmos mods',
  );
});

test('no servidor oficial, é a opção que põe o CL — não o servidor', async () => {
  // A regressão passou despercebida porque em bancho.py ela não existe: lá o
  // engineMods põe o CL de qualquer jeito, e os dois comandos concordavam. Só o
  // Bancho ficava em lazer. Sem esta guarda, um teste rodado num servidor
  // privado passaria com a opção quebrada.
  assert.ok(real.servers.isOfficial(osuMock.DEFAULT_MODE), 'o padrão deveria ser o oficial');

  chamadasMotor.length = 0;
  await pp.simulatePP(129891, ['HR'], { n100: 30 }, osuMock.DEFAULT_MODE);
  const semOpcao = chamadasMotor[0].args.mods;

  assert.ok(
    !semOpcao.some(m => modAcronym(m) === 'CL'),
    'sem a opção, o oficial calcula em lazer — é isso que a opção existe para mudar',
  );
});

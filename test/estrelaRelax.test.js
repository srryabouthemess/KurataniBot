/**
 * A estrela de uma play de Relax sai do motor que pontuou a play.
 *
 * ── O que aconteceu ───────────────────────────────────────────────────────────
 * O `getAdjustedStars` mandava TUDO para o lazer-calculator. Para o vanilla isso
 * é exatamente certo — ele é o C# do próprio osu!, e bate com o site. Para o
 * Relax não: quem pontuou aquele score foi o akatsuki-pp, e as duas contas não
 * são a mesma. O lazer TEM um caminho para o mod RX (zera a velocidade e corta o
 * flashlight), então nada estourava e nada ficava vazio — saía um número
 * plausível, do RX do osu!lazer, ao lado de um pp calculado pelo RX dos
 * servidores de Relax.
 *
 * Medido no Daycore: `Cellar of Ghosts [shoyeu's Faint Whisper 260bpm]` +HDRXNC
 * aparecia como 7.15★ num mapa cujo valor sem mods é 8.945★ — nightcore
 * ACELERA, e a estrela na tela era menor que a do mapa parado.
 *
 * ── Por que o teste olha o MOTOR, e não o número ──────────────────────────────
 * Cravar "7.15 virou X" exigiria as duas libs instaladas e transformaria o teste
 * numa cópia do rework de PP da vez: qualquer atualização do akatsuki-pp o
 * quebraria sem nada estar errado. O que precisa continuar valendo é a decisão —
 * servidor de Relax pergunta ao Python, servidor vanilla pergunta ao lazer — e é
 * ela que está afirmada aqui.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Antes de qualquer require de src/: o paths.js lê a variável no carregamento.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kuratani-estrela-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;

// ─── Os dois motores, trocados por quem só anota ──────────────────────────────
// Não é o `pp` que está sendo dublado: ele é justamente o que se quer exercitar,
// porque é dele a escolha entre um motor e outro.

const chamadasLazer = [];
const lazerPath = require.resolve('../src/lazerWorker');
require.cache[lazerPath] = {
  id: lazerPath, filename: lazerPath, loaded: true,
  exports: {
    calcular: async (op, mapId, args) => {
      chamadasLazer.push({ op, mapId, args });
      return { pp: 100, stars: 5.55, maxCombo: 500 };
    },
    close: () => {},
    stats: () => ({}),
  },
};

const chamadasPython = [];
const pythonPath = require.resolve('../src/pythonWorker');
require.cache[pythonPath] = {
  id: pythonPath, filename: pythonPath, loaded: true,
  exports: {
    calcular: async (bytes, params) => {
      chamadasPython.push(params);
      return { pp: 200, stars: 6.66, max_combo: 500 };
    },
    reportPythonFailure: () => {},
    close: () => {},
  },
};

// O .osu não interessa aqui, e baixá-lo tornaria o teste dependente de rede.
const filePath = require.resolve('../src/beatmapFile');
require.cache[filePath] = {
  id: filePath, filename: filePath, loaded: true,
  exports: { getBeatmapFile: async () => new Uint8Array([0]) },
};

const pp = require('../src/pp');
const db = require('../src/db');
const servers = require('../src/servers');
const { modsToBits } = require('../src/mods');

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// O Akatsuki é embutido (ver servers.js), então o par VN/RX existe sem depender
// do .env de quem roda a suíte.
const VANILLA = 'akatsuki';
const RELAX   = servers.relaxKey(VANILLA);

// Cada teste tem o seu mapa: a map_difficulty não tem TTL, e dois testes no
// mesmo id fariam o segundo ler o que o primeiro gravou.
let proximoMapa = 700000;
const novoMapa = () => proximoMapa++;

test.beforeEach(() => {
  chamadasLazer.length = 0;
  chamadasPython.length = 0;
});

test('o par VN/RX do Akatsuki existe no registro', () => {
  assert.ok(RELAX, 'sem a variante _rx não há o que testar');
  assert.equal(servers.isRelax(RELAX), true);
  assert.equal(servers.isRelax(VANILLA), false);
});

test('servidor vanilla continua no lazer-calculator', async () => {
  const estrelas = await pp.getAdjustedStars(novoMapa(), ['HD', 'DT'], VANILLA);

  assert.equal(estrelas, '5.55');
  assert.equal(chamadasLazer.length, 1);
  assert.equal(chamadasPython.length, 0);
});

test('servidor de Relax vai para o akatsuki-pp, com o RX no bitmask', async () => {
  const estrelas = await pp.getAdjustedStars(novoMapa(), ['HD', 'NC', 'RX'], RELAX);

  assert.equal(estrelas, '6.66');
  assert.equal(chamadasPython.length, 1);
  assert.equal(chamadasLazer.length, 0, 'o lazer respondeu por uma play de Relax');

  // O bit do RX é o que faz o motor calcular Relax em vez de vanilla; sem ele o
  // número sairia do algoritmo errado dentro do motor certo.
  const bitDoRX = modsToBits(['RX']);
  assert.equal((chamadasPython[0].mods & bitDoRX) === bitDoRX, true);
});

test('sem mod de dificuldade, o Relax ainda calcula — o vanilla é que confia na API', async () => {
  // No vanilla, mapa sem mod de dificuldade tem a estrela publicada pela API, e
  // ela é o mesmo número de graça. No Relax não existe valor publicado: o que a
  // API traz é a estrela do vanilla, que é justamente o que não serve.
  const semMods = await pp.getAdjustedStars(novoMapa(), ['CL'], VANILLA);
  assert.equal(semMods, null);
  assert.equal(chamadasLazer.length, 0);

  const relax = await pp.getAdjustedStars(novoMapa(), ['CL'], RELAX);
  assert.equal(relax, '6.66');
  assert.equal(chamadasPython.length, 1);
});

test('o cache separa os dois motores, e não serve um pelo outro', async () => {
  const mapa = novoMapa();
  const mods = ['HD', 'NC', 'RX'];

  const doRelax   = await pp.getAdjustedStars(mapa, mods, RELAX);
  const doVanilla = await pp.getAdjustedStars(mapa, mods, VANILLA);

  // Mesmo mapa, mesmos mods: com uma chave sem o motor, o segundo teria lido a
  // linha do primeiro e os dois sairiam iguais.
  assert.equal(doRelax, '6.66');
  assert.equal(doVanilla, '5.55');
  assert.equal(chamadasPython.length, 1);
  assert.equal(chamadasLazer.length, 1);

  // E a segunda exibição de cada um não recalcula nada.
  assert.equal(await pp.getAdjustedStars(mapa, mods, RELAX), '6.66');
  assert.equal(await pp.getAdjustedStars(mapa, mods, VANILLA), '5.55');
  assert.equal(chamadasPython.length, 1);
  assert.equal(chamadasLazer.length, 1);
});

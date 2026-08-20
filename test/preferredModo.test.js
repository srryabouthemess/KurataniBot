/**
 * O modo preferido (VN / RX / VN+RX) precisa chegar na CHAVE de servidor.
 *
 * O `/link` pergunta as duas coisas em opções separadas — servidor numa,
 * VN/RX/VN+RX em outra —, mas todo o resto do bot trabalha com uma chave só, e
 * "Daycore, leaderboard de Relax" se escreve `daycore_rx`. Quem faz essa
 * costura é o `resolvePlayer`.
 *
 * Sem ela, escolher RX no `/link` não faria efeito em lugar nenhum: só o
 * `/recent` sabe o que é um modo, então `/topplays`, `/profile` e companhia
 * continuariam mostrando o vanilla — e em silêncio, que é o pior jeito de
 * ignorar uma preferência que a pessoa acabou de configurar.
 */
const test = require('node:test');
const assert = require('node:assert');

let servidorSalvo = null;
let modoSalvo     = null;

// Trocado ANTES de carregar o userLink: ele resolve o db no require do topo.
// Só o `resolvePlayer` toca no banco aqui, então o dublê evita abrir o de
// verdade só por causa de duas preferências (mesmo padrão de fetchPlayer.test).
{
  const resolvido = require.resolve('../src/db');
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports: {
      getLink:            () => ({ osu_user: 'pudim2', osu_id: 42 }),
      getPreferredServer: () => servidorSalvo,
      getPreferredModo:   () => modoSalvo,
      getUserLang:        () => null,
      getServerLang:      () => null,
    },
  };
}

const { resolvePlayer } = require('../src/userLink');

/** Uma interação com as opções que o comando declarou, e nada além. */
function interacao(opcoes = {}) {
  return {
    user:    { id: 'u1' },
    guildId: null,
    options: { getString: nome => opcoes[nome] ?? null },
  };
}

/** O servidor que o comando vai usar, dado o que está salvo no link. */
function modoResolvido({ servidor, modo, opcoes = {} }) {
  servidorSalvo = servidor;
  modoSalvo     = modo;
  return resolvePlayer(interacao(opcoes)).mode;
}

test('a preferência de modo aponta a chave do servidor', async t => {
  await t.test('rx leva ao leaderboard de Relax', () => {
    assert.equal(modoResolvido({ servidor: 'daycore', modo: 'rx' }), 'daycore_rx');
  });

  await t.test('vn traz de volta para o vanilla, mesmo com a chave RX salva', () => {
    // Quem escolheu RX quando o `server:` ainda listava as variantes tem
    // `daycore_rx` salvo; pedir VN depois precisa vencer isso.
    assert.equal(modoResolvido({ servidor: 'daycore_rx', modo: 'vn' }), 'daycore');
  });

  await t.test('both cai no vanilla fora do /recent', () => {
    // Juntar as duas listas é coisa que só o /recent e o /rs fazem (eles leem a
    // preferência direto). Os outros comandos mostram UM leaderboard, e o
    // vanilla é o que a pessoa vê quando não há como mostrar os dois.
    assert.equal(modoResolvido({ servidor: 'daycore', modo: 'both' }), 'daycore');
  });

  await t.test('sem preferência de modo, a chave salva vale como está', () => {
    assert.equal(modoResolvido({ servidor: 'daycore_rx', modo: null }), 'daycore_rx');
    assert.equal(modoResolvido({ servidor: 'daycore',    modo: null }), 'daycore');
  });

  await t.test('servidor sem Relax não vira uma chave que não existe', () => {
    // `official_rx` não está no registro: pedir RX no Bancho tem que continuar
    // no Bancho, não virar uma chave que o `servers.get` resolveria no padrão.
    assert.equal(modoResolvido({ servidor: 'official', modo: 'rx' }), 'official');
  });

  await t.test('o server: do comando vence a preferência salva', () => {
    assert.equal(
      modoResolvido({ servidor: 'daycore', modo: 'rx', opcoes: { server: 'official' } }),
      'official',
    );
  });
});

/**
 * Comando efêmero não existe no modo texto.
 *
 * Efêmero só existe dentro de interação. O adaptador do prefixo precisa tirar a
 * flag (senão o envio falha), e aí a resposta que só o autor veria vira mensagem
 * no canal. A trava de privilégio continua valendo — não é escalada —, mas o
 * `/moderate log` despejaria alvos e motivos de moderação para quem estivesse
 * lendo, e o `/staff list` diria quem no Discord é quem no jogo.
 */
const test = require('node:test');
const assert = require('node:assert');

const { buildSpec } = require('../src/prefix/spec');

const moderate = require('../src/commands/moderate');
const staff    = require('../src/commands/staff');
const nominate = require('../src/commands/nominate');
const recent   = require('../src/commands/recent');

test('os comandos que respondem em efêmero se declaram', () => {
  assert.equal(moderate.prefix?.slashOnly, true);
  assert.equal(staff.prefix?.slashOnly, true);
});

test('e por isso não ganham spec de texto', () => {
  assert.equal(buildSpec(moderate), null);
  assert.equal(buildSpec(staff), null);
});

test('o resto continua no modo texto', () => {
  // A trava é cirúrgica: só quem responde em efêmero sai. O /nominate aplica
  // status com resposta pública, e o /recent é o caso de uso comum do prefixo.
  assert.notEqual(buildSpec(nominate), null);
  assert.notEqual(buildSpec(recent), null);
});

test('sem a declaração, o comando continua ganhando spec', () => {
  // Garante que a trava é opt-in e não passou a valer para todo mundo.
  const semDeclaracao = { data: recent.data, execute: recent.execute };
  assert.notEqual(buildSpec(semDeclaracao), null);
});

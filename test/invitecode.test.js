/**
 * /invitecode — gera convite do Daycore.
 *
 * O código replica exatamente o CreateInvite.java do site (ver o cabeçalho
 * de src/daycoreInvites.js): mesmo alfabeto, mesmo tamanho, mesmo INSERT.
 * Estes testes conferem isso sem tocar em banco de verdade — o mysql2 é
 * stubado antes do require, no mesmo espírito do stub de redis em
 * test/role.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.DAYCORE_MYSQL_HOST = '127.0.0.1';

const executed = [];
const mysql2 = require('mysql2/promise');
mysql2.createPool = () => ({
  async execute(sql, params) {
    executed.push([sql, params]);
    // Simula ER_DUP_ENTRY na primeira chamada de um teste específico; os
    // demais testes nunca populam `forceDupOnce`, então caem direto aqui.
    if (module.exports._forceDupOnce) {
      module.exports._forceDupOnce = false;
      const err = new Error('Duplicate entry');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }
    return [{ insertId: 1 }];
  },
  async query() { return [[{ 1: 1 }]]; },
  async end() {},
});

const daycoreInvites = require('../src/daycoreInvites');
const invitecode = require('../src/commands/invitecode');

test('o alfabeto é exatamente o do CreateInvite.java do Shiina (sem I/O/0/1)', () => {
  // Lido direto do fonte no VPS em 11/09/2026 — ver o cabeçalho do módulo
  // para onde. Qualquer caractere fora disso produziria um convite que o
  // register.java aceitaria, mas que não seria idêntico a um do painel.
  assert.equal(daycoreInvites.CODE_CHARS, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  assert.equal(daycoreInvites.CODE_LENGTH, 10);
});

test('randomCode só usa caracteres do alfabeto, no tamanho certo', () => {
  for (let i = 0; i < 50; i++) {
    const code = daycoreInvites.randomCode();
    assert.equal(code.length, daycoreInvites.CODE_LENGTH);
    for (const ch of code) {
      assert.ok(daycoreInvites.CODE_CHARS.includes(ch), `caractere fora do alfabeto: ${ch}`);
    }
  }
});

test('createInviteCode grava exatamente as colunas do CreateInvite.java', async () => {
  executed.length = 0;
  const code = await daycoreInvites.createInviteCode({
    maxUses: 5,
    expiresDays: 7,
    note: 'teste',
    createdByOsuId: 42,
  });

  assert.equal(executed.length, 1);
  const [sql, params] = executed[0];
  assert.match(sql, /INSERT INTO `invite_codes`\(`code`, `created_by`, `max_uses`, `expires_at`, `note`, `creation_time`\)/);
  assert.equal(params[0], code);
  assert.equal(params[1], 42);
  assert.equal(params[2], 5);
  assert.ok(params[3] > Math.floor(Date.now() / 1000)); // expires_at no futuro
  assert.equal(params[4], 'teste');
  assert.ok(params[5] <= Math.floor(Date.now() / 1000));
});

test('sem expires_days, expires_at vai NULL — convite nunca expira', async () => {
  executed.length = 0;
  await daycoreInvites.createInviteCode({ maxUses: 1, createdByOsuId: 1 });

  const [, params] = executed[0];
  assert.equal(params[3], null);
});

test('max_uses menor que 1 vira 1 — nunca gera convite inutilizável', async () => {
  executed.length = 0;
  await daycoreInvites.createInviteCode({ maxUses: 0, createdByOsuId: 1 });

  const [, params] = executed[0];
  assert.equal(params[2], 1);
});

test('note além de 255 caracteres é cortada, como a coluna do banco permite', async () => {
  executed.length = 0;
  const longa = 'x'.repeat(300);
  await daycoreInvites.createInviteCode({ maxUses: 1, note: longa, createdByOsuId: 1 });

  const [, params] = executed[0];
  assert.equal(params[4].length, 255);
});

test('colisão de UNIQUE(code) tenta de novo, em vez de falhar na hora', async () => {
  executed.length = 0;
  module.exports._forceDupOnce = true;
  const code = await daycoreInvites.createInviteCode({ maxUses: 1, createdByOsuId: 1 });

  assert.equal(executed.length, 2); // uma tentativa falhou, a segunda gravou
  assert.equal(code.length, daycoreInvites.CODE_LENGTH);
});

test('erro que não é ER_DUP_ENTRY sobe na hora, sem retry', async () => {
  const original = mysql2.createPool;
  try {
    mysql2.createPool = () => ({
      async execute() { throw new Error('conexão recusada'); },
    });
    // Força o daycoreInvites a criar um pool novo com este stub.
    delete require.cache[require.resolve('../src/daycoreInvites')];
    const isolado = require('../src/daycoreInvites');
    await assert.rejects(
      () => isolado.createInviteCode({ maxUses: 1, createdByOsuId: 1 }),
      /conexão recusada/,
    );
  } finally {
    mysql2.createPool = original;
    delete require.cache[require.resolve('../src/daycoreInvites')];
  }
});

test('exige ADMINISTRATOR — o mesmo bit que o PermissionHelper.java do site exige no formulário', () => {
  // Não DEVELOPER (como /wipe e /scorewipe, ações irreversíveis): gerar
  // convite não desfaz estado de ninguém, e travar mais alto que o próprio
  // site travaria negaria pelo bot o que o site já permite.
  const fonte = require('fs').readFileSync(require.resolve('../src/commands/invitecode'), 'utf8');
  assert.match(fonte, /resolveStaff\(interaction, daycore\.Privileges\.ADMINISTRATOR, s\)/);
});

test('fica fora do modo texto', () => {
  // Mesmo motivo do /role e do /scorewipe: em texto a flag de efêmero some.
  assert.equal(invitecode.prefix?.slashOnly, true);
});

test('as opções batem com os campos que o CreateInvite.java aceita', () => {
  const json = invitecode.data.toJSON();
  const nomes = json.options.map(o => o.name).sort();
  assert.deepEqual(nomes, ['expires_days', 'max_uses', 'note']);

  const note = json.options.find(o => o.name === 'note');
  assert.equal(note.max_length, 255); // mesmo teto da coluna `note`
});

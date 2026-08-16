/**
 * O servidor preferido precisa ser conferido contra o registro na LEITURA.
 *
 * Ele é gravado quando a chave é válida e lido muito depois, e o registro muda
 * por configuração de quem hospeda: tirar um servidor do `SERVERS`, ou desligar
 * um embutido pelo `BUILTIN_SERVERS`, deixa para trás a preferência de quem o
 * usava.
 *
 * O que torna isso perigoso é o `servers.get` cair no padrão em silêncio para
 * chave desconhecida. Com a chave morta saindo daqui, o comando ia buscar o link
 * no namespace do servidor PADRÃO e responder com o rótulo dele — a pessoa
 * perguntava de um servidor e recebia a conta de outro, sem nada na tela
 * denunciando a troca. É o mesmo silêncio que deixou o alias `private` apontar
 * para o servidor errado sem ninguém perceber.
 */
const test = require('node:test');
const assert = require('node:assert');

const { freshDb } = require('./helpers');

test('chave viva é devolvida como está', t => {
  const db = freshDb(t);

  // 'official' está sempre no registro, com ou sem .env — o caso vivo não pode
  // depender de qual servidor esta máquina configurou.
  db.setPreferredServer('u1', 'official');
  assert.equal(db.getPreferredServer('u1'), 'official');
});

test('chave que sumiu do registro é lida como "sem preferência"', t => {
  const db = freshDb(t);

  // Grava direto: o caminho normal (/link default) só aceita as choices do
  // registro, então a chave morta só aparece quando a configuração MUDA depois.
  db.setPreferredServer('u2', 'servidor_que_saiu_do_env');

  assert.equal(
    db.getPreferredServer('u2'), null,
    'devolver a chave morta faz o comando ler o link do servidor padrão calado',
  );
});

test('quem nunca escolheu continua sem preferência', t => {
  const db = freshDb(t);
  assert.equal(db.getPreferredServer('u3'), null);
});

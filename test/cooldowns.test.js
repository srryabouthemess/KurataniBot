/**
 * Atalho não pode ter cooldown mais frouxo que o comando de origem.
 *
 * O bucket é escolhido pelo NOME invocado, então um alias fora da tabela cai no
 * 'default' — e o /top, que chama o comando mais pesado do bot, passou tempo
 * assim: bastava escrever o atalho para driblar o limite do /topplays. O mesmo
 * já tinha acontecido com o /wi antes.
 *
 * A lista de atalhos vem do catálogo do /help, e não de uma cópia escrita aqui:
 * o `help.test.js` já confere que ela bate com os comandos registrados de
 * verdade, então um atalho novo entra neste teste sozinho.
 */
const test = require('node:test');
const assert = require('node:assert');

const cooldowns = require('../src/cooldowns');
const { catalog } = require('../src/commands/help');

test('todo atalho cai no mesmo bucket do comando que ele chama', () => {
  for (const [canonical, aliases] of Object.entries(catalog.ALIASES)) {
    for (const alias of aliases) {
      assert.equal(
        cooldowns.bucketOf(alias),
        cooldowns.bucketOf(canonical),
        `/${alias} cai em "${cooldowns.bucketOf(alias)}" e /${canonical} em "${cooldowns.bucketOf(canonical)}"`,
      );
    }
  }
});

test('o comando pesado continua pesado — pelo atalho também', () => {
  // Fixa o caso concreto que motivou o teste: se alguém tirar o /topplays do
  // 'heavy', é uma decisão, e ela deve aparecer aqui.
  assert.equal(cooldowns.bucketOf('topplays'), 'heavy');
  assert.equal(cooldowns.bucketOf('top'), 'heavy');
});

test('comando sem bucket declarado cai no default', () => {
  assert.equal(cooldowns.bucketOf('help'), 'default');
  assert.equal(cooldowns.bucketOf('comando-que-nao-existe'), 'default');
});

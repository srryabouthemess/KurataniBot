/**
 * src/paths.js
 * Onde ficam as coisas que NÃO são código.
 *
 * O código mora em `src/`, mas os dados e os assets ficam na raiz do projeto:
 * o banco não deve viajar junto de uma reorganização de pastas, e os emojis
 * são conteúdo, não fonte.
 *
 * Sem este módulo, cada arquivo resolveria isso com o seu próprio
 * `path.join(__dirname, '..')` — e bastaria um deles esquecer o `..` para o bot
 * criar um banco vazio dentro de `src/` e "perder" todos os links dos usuários.
 */

const path = require('path');

/** Raiz do projeto — um nível acima de `src/`. */
const ROOT = path.join(__dirname, '..');

/**
 * Onde os DADOS ficam. Por padrão a raiz do projeto, que é onde eles sempre
 * estiveram — quem não define nada não vê diferença nenhuma.
 *
 * `KURATANI_DATA_DIR` aponta para outro lugar, e serve a dois casos:
 *
 *   - teste: sem isto, exercitar a evicção de um cache significa apagar o
 *     cache real da máquina de quem roda `npm test`;
 *   - hospedagem: banco em volume separado do código, que é o normal quando o
 *     deploy é `git pull` numa VPS.
 *
 * Vale para tudo que é dado, inclusive os arquivos JSON das versões antigas que
 * as migrações procuram: uma regra só ("dado mora aqui") em vez de metade num
 * lugar e metade no outro.
 *
 * ASSETS fica de fora de propósito — emoji é conteúdo que viaja junto do
 * código, não dado que o bot produz.
 */
const DATA_DIR = process.env.KURATANI_DATA_DIR
  ? path.resolve(process.env.KURATANI_DATA_DIR)
  : ROOT;

module.exports = {
  ROOT,
  DATA_DIR,
  BOT_DB:   path.join(DATA_DIR, 'bot.db'),
  CACHE_DB: path.join(DATA_DIR, 'cache.db'),
  ASSETS:   path.join(ROOT, 'assets'),
};

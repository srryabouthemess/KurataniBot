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

module.exports = {
  ROOT,
  BOT_DB:   path.join(ROOT, 'bot.db'),
  CACHE_DB: path.join(ROOT, 'cache.db'),
  ASSETS:   path.join(ROOT, 'assets'),
};

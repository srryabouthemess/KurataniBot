/**
 * src/paths.js
 * Onde ficam as coisas que NÃO são código.
 *
 * O código mora em `src/`; os dados ficam em `data/` e os assets em `assets/`,
 * os dois fora dele: o banco não deve viajar junto de uma reorganização de
 * pastas, e os emojis são conteúdo, não fonte.
 *
 * Sem este módulo, cada arquivo resolveria isso com o seu próprio
 * `path.join(__dirname, '..')` — e bastaria um deles esquecer o `..` para o bot
 * criar um banco vazio dentro de `src/` e "perder" todos os links dos usuários.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

/** Raiz do projeto — um nível acima de `src/`. */
const ROOT = path.join(__dirname, '..');

/**
 * Onde os DADOS ficam: `data/`, na raiz do projeto.
 *
 * Já foi a própria raiz, ao lado do package.json. Numa pasta só, o que o bot
 * produz fica separado do que vem do git: um `ls` não mistura banco com código,
 * o backup é "copie a data/", e o .gitignore ignora a pasta inteira em vez de
 * listar cada arquivo do SQLite (e os -wal e -shm que o modo WAL cria ao lado).
 *
 * `KURATANI_DATA_DIR` aponta para outro lugar, e serve a dois casos:
 *
 *   - teste: sem isto, exercitar a evicção de um cache significa apagar o
 *     cache real da máquina de quem roda `npm test`;
 *   - hospedagem: banco em volume separado do código.
 *
 * ASSETS fica de fora de propósito — emoji é conteúdo que viaja junto do
 * código, não dado que o bot produz.
 */
const DEFAULT_DATA_DIR = path.join(ROOT, 'data');
const DATA_DIR = config.dataDir ? path.resolve(config.dataDir) : DEFAULT_DATA_DIR;

/**
 * O que ficou na RAIZ de quando os dados moravam lá, e ainda não foi movido.
 *
 * Sem esta checagem, atualizar o bot sem mover os arquivos criaria um `bot.db`
 * vazio em `data/` — e o bot subiria normalmente, sem nenhum link, idioma ou
 * vínculo de staff. É a pior forma de falhar: parece que funcionou, e cada
 * pessoa descobre sozinha que o link dela sumiu. Quem chama recusa subir.
 *
 * Só vale para a pasta PADRÃO: quem define o KURATANI_DATA_DIR escolheu o
 * lugar de propósito (os testes apontam para uma pasta vazia, e o `bot.db` da
 * raiz de quem roda a suíte não tem nada a ver com eles).
 *
 * @returns {string[]} os arquivos da raiz que deveriam estar em `data/`
 */
function dadosEsquecidosNaRaiz({
  explicito = Boolean(config.dataDir),
  dataDir = DATA_DIR,
  root = ROOT,
  existe = fs.existsSync,
} = {}) {
  if (explicito) return [];
  if (existe(path.join(dataDir, 'bot.db'))) return [];
  return ['bot.db', 'cache.db', 'links.json', 'languages.json'].filter(f => existe(path.join(root, f)));
}

module.exports = {
  ROOT,
  DATA_DIR,
  dadosEsquecidosNaRaiz,
  BOT_DB:   path.join(DATA_DIR, 'bot.db'),
  CACHE_DB: path.join(DATA_DIR, 'cache.db'),
  ASSETS:   path.join(ROOT, 'assets'),
};

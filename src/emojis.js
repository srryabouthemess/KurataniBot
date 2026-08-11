/**
 * emojis.js
 * Emojis próprios do bot, usáveis em qualquer lugar.
 *
 * Emoji normal pertence a um servidor: para o bot usar o emoji do servidor X
 * em outro lugar ele precisaria estar em X e ter permissão de emoji externo no
 * canal — o que quebra justamente onde mais importa (DM e servidor de quem
 * acabou de adicionar o bot). **Application emoji** pertence ao aplicativo, não
 * a um servidor: o bot usa em toda guild e em DM, sem depender de permissão
 * nenhuma. O limite é 2000 por aplicativo.
 *
 * O que vale é a pasta `assets/emojis`: cada arquivo vira um emoji com o nome
 * do arquivo, enviado uma única vez (no boot seguinte ele já existe e é
 * reaproveitado). Nada é apagado do aplicativo aqui — remover arquivo não
 * remove emoji, para um deploy de uma máquina com a pasta incompleta não sair
 * derrubando o que a outra subiu.
 *
 * Sem a pasta (ou sem os arquivos), tudo continua funcionando: quem pergunta
 * por um emoji que não existe recebe null e cai no texto de sempre.
 */

const fs = require('fs');
const path = require('path');
const { logError } = require('./logger');

// Fora de src/: emoji é conteúdo, não fonte (ver paths.js).
const ASSETS_DIR = path.join(require('./paths').ASSETS, 'emojis');

// Limite do Discord por emoji.
const MAX_BYTES = 256 * 1024;

// Regra do Discord para nome de emoji.
const VALID_NAME = /^[a-z0-9_]{2,32}$/;

const IMAGE_FILE = /\.(png|gif|jpe?g|webp)$/i;

/**
 * Nome do emoji a partir do nome do arquivo.
 *
 * O Discord só aceita letras, números e `_`, mas os ícones oficiais do osu!
 * vêm como `ranking-A.png` — recusar por causa do hífen seria implicância, já
 * que dá para normalizar sem ambiguidade.
 */
function emojiName(file) {
  return path.basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** nome → `<:nome:id>`, pronto para ir em content/embed. */
const _byName = new Map();

/**
 * Como cada grade pode estar nomeada no arquivo.
 *
 * A API do osu! chama SS de `X` e sufixa com `H` a versão prateada (feita com
 * Hidden/Flashlight) — daí os ícones oficiais virem como `ranking-X.png` e
 * `ranking-XH.png`, enquanto quem batiza na mão escreve `ss` e `ssh`. Aceitar
 * os dois evita ter que renomear o pacote de ícones toda vez que ele for
 * baixado de novo.
 */
const GRADE_NAMES = {
  XH: ['ssh', 'xh'],
  X:  ['ss',  'x'],
  SH: ['sh'],
  S:  ['s'],
  A:  ['a'],
  B:  ['b'],
  C:  ['c'],
  D:  ['d'],
  F:  ['f'],
};

/** SS/SSH são o mesmo que X/XH, só que na fala de quem joga. */
const GRADE_ALIASES = { SS: 'X', SSH: 'XH' };

/** Prefixos aceitos no nome do arquivo: `rank_a`, `ranking_a` ou só `a`. */
const RANK_PREFIXES = ['rank_', 'ranking_', ''];

/**
 * Envia o que ainda não existe no aplicativo e monta o cache de nomes.
 * Chamado uma vez, no boot.
 */
async function sync(client) {
  const existing = await client.application.emojis.fetch();
  for (const emoji of existing.values()) {
    _byName.set(emoji.name, emoji.toString());
  }

  if (!fs.existsSync(ASSETS_DIR)) return;

  let uploaded = 0;

  for (const file of fs.readdirSync(ASSETS_DIR).filter(f => IMAGE_FILE.test(f))) {
    const name = emojiName(file);

    if (!VALID_NAME.test(name)) {
      console.warn(`[emojis] "${file}" ignorado: o nome precisa ter 2-32 caracteres entre letras, números e _.`);
      continue;
    }
    if (_byName.has(name)) continue;

    const filePath = path.join(ASSETS_DIR, file);
    const { size } = fs.statSync(filePath);
    if (size > MAX_BYTES) {
      console.warn(`[emojis] "${file}" ignorado: ${Math.round(size / 1024)}KB passa do limite de 256KB.`);
      continue;
    }

    try {
      const created = await client.application.emojis.create({ attachment: filePath, name });
      _byName.set(name, created.toString());
      uploaded++;
    } catch (error) {
      // Um emoji que falhou não pode impedir os outros — nem o boot.
      logError(`emojis:${name}`, error);
    }
  }

  if (uploaded > 0) console.log(`[emojis] ${uploaded} emoji(s) enviados ao aplicativo.`);
  console.log(`[emojis] ${_byName.size} disponíveis.`);
}

/** @returns {string|null} `<:nome:id>` ou null se não tiver sido enviado. */
function get(name) {
  return _byName.get(String(name).toLowerCase()) ?? null;
}

/** @returns {string|null} emoji da grade (X, XH, S, A...), ou null. */
function rank(grade) {
  const code  = String(grade ?? '').toUpperCase();
  const names = GRADE_NAMES[GRADE_ALIASES[code] ?? code];
  if (!names) return null;

  for (const base of names) {
    for (const prefix of RANK_PREFIXES) {
      const found = get(prefix + base);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Como mostrar a grade numa play: o emoji quando existe, o texto de sempre
 * quando não. É o que deixa a pasta de assets ser opcional.
 */
function rankLabel(grade) {
  return rank(grade) ?? `**${grade}**`;
}

module.exports = { sync, get, rank, rankLabel, ASSETS_DIR };

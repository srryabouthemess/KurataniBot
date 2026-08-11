/**
 * servers.js
 * Quais servidores de osu! este bot atende.
 *
 * O bot nasceu falando "Bancho e Daycore", mas o código sempre tratou o
 * Daycore como "o servidor que não é o oficial" — a única coisa específica
 * dele eram as URLs. Aqui isso vira configuração: o oficial é fixo (é um só),
 * e os demais saem do `.env`, então hospedar o bot para outro servidor não
 * exige tocar no código.
 *
 *   SERVERS=daycore
 *   SERVER_DAYCORE_URL=https://daycore.org
 *   SERVER_DAYCORE_RELAX=true
 *
 * As URLs de API seguem a convenção do onl-docker (bancho.py-ex + Shiina-Web),
 * derivadas do domínio do site — `api.` e `a.` — e podem ser sobrescritas uma
 * a uma quando o servidor foge do padrão.
 *
 * ATENÇÃO ao que "suportar bancho.py" quer dizer: o rank global e as top plays
 * vêm de `get_rank_cache` e `get_player_scores`, que são da **Shiina-Web**, não
 * do bancho.py. Um servidor com outro front-end responde o resto e falha nesses
 * dois — por isso o campo é `web`, separado da `api`.
 *
 * Cada servidor com `RELAX=true` ganha uma segunda entrada `<chave>_rx`: é o
 * mesmo cadastro (mesmo `namespace`, mesmo link do usuário), mudando só o
 * `mode_arg` que vai para a API.
 */

// Carrega o .env aqui também: este módulo lê a configuração no require, e sem
// isso quem o carregasse antes do dotenv (um script, um teste, outro ponto de
// entrada) montaria um registro vazio — e aí todo servidor privado cairia
// calado no oficial. É idempotente.
require('dotenv').config();

const OFFICIAL_KEY = 'official';

/** Nomes que as versões antigas usavam, quando só existia um servidor privado. */
const LEGACY_KEYS = { private: null, private_rx: null };

const _byKey = new Map();

// ─── Leitura do .env ──────────────────────────────────────────────────────────

function envFor(key, field) {
  const value = process.env[`SERVER_${key.toUpperCase()}_${field}`];
  return value?.trim() || null;
}

/** `https://daycore.org` + `api` → `https://api.daycore.org` */
function subdomain(baseUrl, prefix) {
  try {
    const url = new URL(baseUrl);
    url.hostname = `${prefix}.${url.hostname}`;
    return url.origin;
  } catch {
    return null;
  }
}

function titleCase(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function buildBanchoPy(key) {
  const site = envFor(key, 'URL');
  if (!site) {
    console.warn(`[servers] "${key}" ignorado: falta SERVER_${key.toUpperCase()}_URL no .env.`);
    return null;
  }

  const web = site.replace(/\/+$/, '');
  const api = envFor(key, 'API') ?? subdomain(web, 'api');
  if (!api) {
    console.warn(`[servers] "${key}" ignorado: SERVER_${key.toUpperCase()}_URL não é uma URL válida.`);
    return null;
  }

  return {
    key,
    label:     envFor(key, 'LABEL') ?? titleCase(key),
    kind:      'banchopy',
    namespace: key,
    gameMode:  0,
    relax:     false,
    webUrl:    web,
    avatars:   envFor(key, 'AVATARS') ?? subdomain(web, 'a') ?? `${web}/a`,
    // Sem api key: nenhum dos endpoints que o bot usa pede autenticação, e o
    // campo existia sem nunca ser enviado a lugar nenhum — credencial parada só
    // aparece em backup e captura de tela. Se algum endpoint passar a exigir,
    // volta aqui junto do código que a usa.
    // Shiina-Web: get_rank_cache, get_player_scores.
    webApi:    `${web}/api/v1`,
    // bancho.py-ex: busca exata por nome (v1) e leitura de scores/mapas (v2).
    banchoV1:  `${api}/v1`,
    banchoV2:  `${api}/v2`,
  };
}

/** Variante Relax: mesma conta, `mode_arg` diferente. */
function relaxVariant(server) {
  return {
    ...server,
    key:      `${server.key}_rx`,
    label:    `${server.label} RX`,
    gameMode: 4,
    relax:    true,
    // namespace continua o do servidor pai — é o mesmo cadastro.
  };
}

function register(server) {
  if (!server) return;
  if (_byKey.has(server.key)) {
    console.warn(`[servers] "${server.key}" duplicado no SERVERS, ignorando a repetição.`);
    return;
  }
  _byKey.set(server.key, server);
}

function load() {
  register({
    key:       OFFICIAL_KEY,
    label:     'Bancho',
    kind:      'official',
    namespace: OFFICIAL_KEY,
    gameMode:  0,
    relax:     false,
    webUrl:    'https://osu.ppy.sh',
  });

  // `SERVERS` é a lista nova; `PRIVATE_SERVER_URL` era a configuração antiga,
  // de quando só cabia um servidor — continua funcionando, com a chave tirada
  // do próprio domínio (daycore.org → "daycore").
  let keys = (process.env.SERVERS ?? '')
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  if (keys.length === 0 && process.env.PRIVATE_SERVER_URL) {
    const host = (() => {
      try { return new URL(process.env.PRIVATE_SERVER_URL).hostname; } catch { return null; }
    })();
    const key = host?.split('.').filter(p => p !== 'www')[0];

    if (key) {
      process.env[`SERVER_${key.toUpperCase()}_URL`] ??= process.env.PRIVATE_SERVER_URL;
      // A configuração antiga sempre teve o RX ligado.
      process.env[`SERVER_${key.toUpperCase()}_RELAX`] ??= 'true';
      keys = [key];
    }
  }

  for (const key of keys) {
    if (key === OFFICIAL_KEY) {
      console.warn('[servers] "official" é reservado para o osu! oficial, ignorando.');
      continue;
    }
    if (!/^[a-z0-9_]{2,24}$/.test(key)) {
      console.warn(`[servers] "${key}" ignorado: use de 2 a 24 caracteres entre letras, números e _.`);
      continue;
    }

    const server = buildBanchoPy(key);
    if (!server) continue;

    register(server);
    if ((envFor(key, 'RELAX') ?? '').toLowerCase() === 'true') register(relaxVariant(server));
  }

  // As chaves antigas apontam para o primeiro servidor privado configurado —
  // é o que mantém de pé os links e a preferência de quem já usava o bot.
  const firstPrivate = [..._byKey.values()].find(s => s.kind === 'banchopy' && !s.relax);
  if (firstPrivate) {
    LEGACY_KEYS.private = firstPrivate.key;
    LEGACY_KEYS.private_rx = _byKey.has(`${firstPrivate.key}_rx`) ? `${firstPrivate.key}_rx` : firstPrivate.key;
  }
}

load();

// ─── Consulta ─────────────────────────────────────────────────────────────────

/** Traduz nome antigo (`private`, `private_rx`) para a chave atual. */
function resolveKey(key) {
  const wanted = String(key ?? '').toLowerCase();
  if (_byKey.has(wanted)) return wanted;
  return LEGACY_KEYS[wanted] ?? null;
}

/** @returns {object} o servidor pedido, ou o padrão quando a chave não existe. */
function get(key) {
  const resolved = resolveKey(key);
  return resolved ? _byKey.get(resolved) : _byKey.get(defaultKey());
}

function has(key) {
  return resolveKey(key) !== null;
}

/** Todos, na ordem de configuração (o oficial primeiro). */
function all() {
  return [..._byKey.values()];
}

function isOfficial(key) {
  return get(key).kind === 'official';
}

function label(key) {
  return get(key).label;
}

/** Namespace da conta: vanilla e RX de um mesmo servidor compartilham o link. */
function namespace(key) {
  return get(key).namespace;
}

/** Uma chave qualquer daquele namespace — o caminho de volta, para o db. */
function keyForNamespace(ns) {
  return all().find(s => s.namespace === ns && !s.relax)?.key ?? OFFICIAL_KEY;
}

/** Servidor usado quando o comando não diz qual. */
function defaultKey() {
  const wanted = resolveKey(process.env.OSU_MODE);
  return wanted ?? OFFICIAL_KEY;
}

// O Discord aceita no máximo 25 escolhas por opção.
const MAX_CHOICES = 25;

/** Escolhas prontas para o `addChoices` dos comandos. */
function choices() {
  const list = all();
  if (list.length > MAX_CHOICES) {
    console.warn(`[servers] ${list.length} servidores configurados; o Discord só aceita ${MAX_CHOICES} por opção — o excedente não aparece.`);
  }
  return list.slice(0, MAX_CHOICES).map(s => ({ name: s.label, value: s.key }));
}

module.exports = {
  all, get, has, resolveKey, isOfficial, label, namespace, keyForNamespace,
  defaultKey, choices, OFFICIAL_KEY,
};

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
 * saíam de `get_rank_cache` e `get_player_scores`, que são da **Shiina-Web**,
 * não do bancho.py — por isso o campo `webApi` é separado da `api`.
 *
 * Servidor com outro front-end (o EZPP Farm é um) declara `webApi: null`, ou
 * `SERVER_<chave>_WEB=none` no `.env`, e o adaptador busca as duas coisas no
 * próprio bancho.py. O campo continua existindo porque as duas fontes não são
 * intercambiáveis: os endpoints têm o mesmo nome e devolvem formatos
 * diferentes, então quem lê precisa saber de qual está falando.
 *
 * Cada servidor com `RELAX=true` ganha uma segunda entrada `<chave>_rx`: é o
 * mesmo cadastro (mesmo `namespace`, mesmo link do usuário), mudando só o
 * `mode_arg` que vai para a API.
 */

// Carrega o .env aqui também: este módulo lê a configuração no require, e sem
// isso quem o carregasse antes do dotenv (um script, um teste, outro ponto de
// entrada) montaria um registro vazio — e aí todo servidor privado cairia
// calado no oficial. É idempotente.
require('dotenv').config({ quiet: true });

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

/**
 * Monta um servidor bancho.py a partir dos endereços já resolvidos.
 *
 * Vive separado da leitura do `.env` porque os embutidos precisam da mesma
 * forma sem passar por ela — antes um servidor de fábrica teria de repetir à
 * mão os sete campos, e um deles ficaria para trás no dia em que a forma
 * mudasse.
 *
 * `webApi` é o ÚNICO campo que aceita `null`, e é o que separa os dois mundos:
 * `null` quer dizer "este servidor não tem Shiina-Web". Ver o comentário do
 * cabeçalho e o `temShiina` no adaptador.
 */
function banchoPyServer({ key, label, site, api, avatars, webApi }) {
  return {
    key,
    label,
    kind:      'banchopy',
    namespace: key,
    gameMode:  0,
    relax:     false,
    webUrl:    site,
    avatars,
    // Sem api key: nenhum dos endpoints que o bot usa pede autenticação, e o
    // campo existia sem nunca ser enviado a lugar nenhum — credencial parada só
    // aparece em backup e captura de tela. Se algum endpoint passar a exigir,
    // volta aqui junto do código que a usa.
    // Shiina-Web: get_rank_cache, get_player_scores.
    webApi,
    // bancho.py-ex: busca exata por nome (v1) e leitura de scores/mapas (v2).
    banchoV1:  `${api}/v1`,
    banchoV2:  `${api}/v2`,
  };
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

  // SERVER_<chave>_WEB: endereço da API do front-end. O padrão vale para quem
  // roda a Shiina-Web; `none` é para servidor com outro front-end, e faz o
  // adaptador buscar rank e scores direto no bancho.py.
  const front = envFor(key, 'WEB');
  const webApi = front?.toLowerCase() === 'none'
    ? null
    : (front?.replace(/\/+$/, '') ?? `${web}/api/v1`);

  return banchoPyServer({
    key,
    label:   envFor(key, 'LABEL') ?? titleCase(key),
    site:    web,
    api,
    avatars: envFor(key, 'AVATARS') ?? subdomain(web, 'a') ?? `${web}/a`,
    webApi,
  });
}

/**
 * Variante Relax: mesma conta, mesmo namespace, outro leaderboard.
 *
 * COMO o Relax é pedido depende da stack, e as duas não se traduzem uma na
 * outra:
 *
 *   bancho.py — Relax é o "modo 4", no mesmo campo de osu!/taiko/catch/mania.
 *   Ripple    — são dois eixos: `mode` (0-3) e `rx` (0 vanilla, 1 relax,
 *               2 autopilot). O modo continua 0.
 *
 * Antes isto era `gameMode: 4` fixo, o que só valia para bancho.py. Agora cada
 * tipo diz como pede o seu, e o adaptador lê o campo que lhe interessa.
 */
function relaxVariant(server) {
  const comoPedeRelax = server.kind === 'ripple'
    ? { gameMode: 0, rx: 1 }
    : { gameMode: 4, rx: 0 };

  return {
    ...server,
    ...comoPedeRelax,
    key:   `${server.key}_rx`,
    label: `${server.label} RX`,
    relax: true,
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

/**
 * Servidores que vêm de fábrica, sem precisar de `.env`.
 *
 * O osu! oficial é fixo porque é um só. O Akatsuki entra pelo mesmo motivo
 * prático: é um dos maiores servidores privados, a API é pública e estável, e
 * exigir configuração para algo que vale para todo mundo só empurraria a mesma
 * receita para cada instalação.
 *
 * A diferença é que este dá para desligar — `BUILTIN_SERVERS=` vazio, ou uma
 * lista sem ele. Quem hospeda o bot para outro servidor não fica carregando um
 * concorrente na lista de escolhas.
 */
const BUILTINS = {
  akatsuki: {
    key:       'akatsuki',
    label:     'Akatsuki',
    kind:      'ripple',
    namespace: 'akatsuki',
    gameMode:  0,
    rx:        0,
    relax:     false,
    webUrl:    'https://akatsuki.gg',
    avatars:   'https://a.akatsuki.gg',
    builtinRelax: true,
  },

  // O EZPP Farm é bancho.py, mas o front-end NÃO é a Shiina-Web: `ez-pp.farm`
  // é uma aplicação Svelte, e `/api/v1/...` lá devolve o HTML da página em vez
  // de JSON. Daí o `webApi: null` — sem ele, o rank global e as top plays
  // tentariam ler uma página inteira como se fosse a resposta de uma API.
  //
  // Tudo o que a Shiina-Web serviria tem contraparte no próprio bancho.py
  // (`get_player_info` com `scope=stats` traz o rank, `get_player_scores` traz
  // as plays), e é de lá que o adaptador busca quando este campo é nulo.
  //
  // Entra de fábrica pelo mesmo motivo do Akatsuki: servidor grande, API
  // pública e estável, e nada aqui depende de configuração de quem hospeda.
  ezppfarm: {
    ...banchoPyServer({
      key:     'ezppfarm',
      label:   'EZPP Farm',
      site:    'https://ez-pp.farm',
      api:     'https://api.ez-pp.farm',
      avatars: 'https://a.ez-pp.farm',
      webApi:  null,
    }),
    builtinRelax: true,
  },
};

/** Quais embutidos ligar. Ausente = todos; vazio = nenhum. */
function builtinsPedidos() {
  const bruto = process.env.BUILTIN_SERVERS;
  if (bruto === undefined) return Object.keys(BUILTINS);
  return bruto.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
}

function load() {
  register({
    key:       OFFICIAL_KEY,
    label:     'Bancho',
    kind:      'official',
    namespace: OFFICIAL_KEY,
    gameMode:  0,
    rx:        0,
    relax:     false,
    webUrl:    'https://osu.ppy.sh',
  });

  for (const chave of builtinsPedidos()) {
    const embutido = BUILTINS[chave];
    if (!embutido) {
      console.warn(`[servers] "${chave}" não é um servidor embutido; ignorando.`);
      continue;
    }
    // O `.env` ganha do embutido: quem quiser apontar a mesma chave para outro
    // host declara em SERVERS e o register recusa a duplicata depois.
    register({ ...embutido });
    if (embutido.builtinRelax) register(relaxVariant(embutido));
  }

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

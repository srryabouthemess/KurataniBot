/**
 * config.js
 * O `.env` do bot, lido num lugar só.
 *
 * Antes eram vinte e tantas variáveis lidas direto do `process.env` em dezesseis
 * arquivos, cada um com o seu default e a sua conversão — o bloco de conexão do
 * Redis estava copiado em dois deles. E nada conferia nada: um `REDIS_PORT=63799`
 * ou um id de canal com um dígito a menos só aparecia quando a feature falhava,
 * calada, em produção.
 *
 * ── Getters, não valores ──────────────────────────────────────────────────────
 * Cada campo lê o ambiente NA HORA do acesso. Congelar no require quebraria os
 * testes que trocam uma variável entre dois casos, e obrigaria todo ponto de
 * entrada a garantir que o `.env` foi lido antes de qualquer outro require.
 *
 * ── Leitura tolerante, conferência no boot ────────────────────────────────────
 * Valor inválido vira o default na leitura (o bot não cai no meio de um comando
 * por causa do `.env`), e o `validate()` — chamado pelo index.js e pelo
 * deploy-commands.js — é quem recusa subir com ele. `npm run config:check`
 * roda só a conferência, para testar um `.env` antes do restart.
 *
 * Fora daqui só o servers.js lê o ambiente: as variáveis `SERVER_<CHAVE>_*` têm
 * nome dinâmico, e o próprio servers.js é a configuração dos servidores.
 */

// Idempotente, e o primeiro require de quem lê configuração: nenhum ponto de
// entrada precisa lembrar de carregar o `.env` antes do resto.
require('dotenv').config({ quiet: true });

// ─── Leitura ──────────────────────────────────────────────────────────────────

/** Texto, sem espaço nas pontas. Vazio conta como ausente. */
function str(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Segredo: exatamente como está no `.env`, sem `trim`. O dotenv já apara valor
 * sem aspas; espaço que sobrou veio entre aspas, de propósito, e numa senha
 * faz parte dela. Vazio conta como ausente, como antes.
 */
function secret(name) {
  return process.env[name] || null;
}

/** Inteiro >= `min`, ou `null` se estiver presente e não for isso. */
function readInt(name, min) {
  const raw = str(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : null;
}

function int(name, fallback, min = 0) {
  return readInt(name, min) ?? fallback;
}

const TRUE_RE  = /^(1|true|yes|sim)$/i;
const FALSE_RE = /^(0|false|no|nao|não)$/i;

function bool(name) {
  return TRUE_RE.test(str(name) ?? '');
}

// ─── Os campos ────────────────────────────────────────────────────────────────

const config = {
  get discord() {
    return {
      token:    secret('DISCORD_TOKEN'),
      clientId: str('CLIENT_ID'),
    };
  },

  /** Prefixo do modo texto (`k!`). Vazio desliga o modo inteiro. */
  get commandPrefix() {
    return str('COMMAND_PREFIX') ?? '';
  },

  get osu() {
    return {
      clientId:     str('OSU_CLIENT_ID'),
      clientSecret: secret('OSU_CLIENT_SECRET'),
    };
  },

  /** Pasta dos dados (bancos). `null` = a raiz do projeto — ver paths.js. */
  get dataDir() {
    return str('KURATANI_DATA_DIR');
  },

  get cache() {
    return {
      beatmapMaxRows: int('BEATMAP_CACHE_MAX', 1500, 1),
      fcPpMaxRows:    int('FC_PP_CACHE_MAX', 20000, 1),
    };
  },

  /** Sair com código 1 em exceção não capturada — ver index.js. */
  get exitOnUncaught() {
    return bool('EXIT_ON_UNCAUGHT');
  },

  /**
   * No Windows o instalador do python.org cria o binário "python"; na maioria
   * das distros Linux (PEP 394) só "python3" existe por padrão.
   */
  get pythonBin() {
    return str('PYTHON_BIN') ?? (process.platform === 'win32' ? 'python' : 'python3');
  },

  get daycore() {
    return {
      /** O Discord administrado. Sem ele, os comandos administrativos recusam tudo. */
      guildId:              str('DAYCORE_GUILD_ID'),
      announceChannelId:    str('DAYCORE_ANNOUNCE_CHANNEL_ID'),
      roleLogChannelId:     str('DAYCORE_ROLE_LOG_CHANNEL_ID'),
      customMapChannelId:   str('DAYCORE_CUSTOM_MAP_CHANNEL_ID'),
      nominationThreshold:  int('NOMINATION_THRESHOLD', 1, 1),
    };
  },

  /**
   * Conexão com o Redis do servidor, ou `null` sem REDIS_HOST.
   *
   * Credenciais como campos separados, e não numa URL `redis://user:senha@host`:
   * a URL aparece em mensagem de erro de conexão do client, que vai parar no log.
   */
  get redis() {
    const host = str('REDIS_HOST');
    if (!host) return null;
    return {
      host,
      port:     int('REDIS_PORT', 6379, 1),
      username: str('REDIS_USER') ?? undefined,
      password: secret('REDIS_PASS') ?? undefined,
      database: int('REDIS_DB', 0, 0),
    };
  },

  /** MySQL do bancho (/invitecode e /matchcost), ou `null` sem DAYCORE_MYSQL_HOST. */
  get daycoreMysql() {
    const host = str('DAYCORE_MYSQL_HOST');
    if (!host) return null;
    return {
      host,
      port:     int('DAYCORE_MYSQL_PORT', 3306, 1),
      user:     str('DAYCORE_MYSQL_USER') ?? undefined,
      password: secret('DAYCORE_MYSQL_PASS') ?? undefined,
      database: str('DAYCORE_MYSQL_DATABASE') ?? 'bancho',
    };
  },
};

// ─── Conferência ──────────────────────────────────────────────────────────────

/** Variáveis desta camada — o teste confere contra o `.env.example`. */
const VARS = [
  'DISCORD_TOKEN', 'CLIENT_ID', 'COMMAND_PREFIX',
  'OSU_CLIENT_ID', 'OSU_CLIENT_SECRET',
  'KURATANI_DATA_DIR', 'BEATMAP_CACHE_MAX', 'FC_PP_CACHE_MAX',
  'EXIT_ON_UNCAUGHT', 'PYTHON_BIN',
  'DAYCORE_GUILD_ID', 'DAYCORE_ANNOUNCE_CHANNEL_ID', 'DAYCORE_ROLE_LOG_CHANNEL_ID',
  'DAYCORE_CUSTOM_MAP_CHANNEL_ID', 'NOMINATION_THRESHOLD',
  'REDIS_HOST', 'REDIS_PORT', 'REDIS_USER', 'REDIS_PASS', 'REDIS_DB',
  'DAYCORE_MYSQL_HOST', 'DAYCORE_MYSQL_PORT', 'DAYCORE_MYSQL_USER',
  'DAYCORE_MYSQL_PASS', 'DAYCORE_MYSQL_DATABASE',
];

const INTS = {
  BEATMAP_CACHE_MAX: 1, FC_PP_CACHE_MAX: 1, NOMINATION_THRESHOLD: 1,
  REDIS_PORT: 1, REDIS_DB: 0, DAYCORE_MYSQL_PORT: 1,
};

const SNOWFLAKES = [
  'CLIENT_ID', 'DAYCORE_GUILD_ID', 'DAYCORE_ANNOUNCE_CHANNEL_ID',
  'DAYCORE_ROLE_LOG_CHANNEL_ID', 'DAYCORE_CUSTOM_MAP_CHANNEL_ID',
];
const SNOWFLAKE_RE = /^\d{17,20}$/;

/**
 * Confere o ambiente. Só aponta NOMES de variável, nunca o valor: a saída vai
 * para o log, e metade destas variáveis é credencial.
 *
 * @param {object}  [options]
 * @param {boolean} [options.discord=true]  exigir token e client id (o bot e o
 *   deploy precisam; o `config:check` também, porque confere o `.env` do bot)
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validate({ discord = true } = {}) {
  const errors   = [];
  const warnings = [];

  if (discord) {
    if (!secret('DISCORD_TOKEN')) errors.push('DISCORD_TOKEN não definido.');
    if (!str('CLIENT_ID'))     errors.push('CLIENT_ID não definido.');
  }

  for (const [name, min] of Object.entries(INTS)) {
    if (readInt(name, min) === null) errors.push(`${name} precisa ser um número >= ${min}.`);
  }

  for (const name of SNOWFLAKES) {
    const value = str(name);
    if (value !== null && !SNOWFLAKE_RE.test(value)) {
      errors.push(`${name} não parece um id do Discord (17 a 20 dígitos).`);
    }
  }

  const exit = str('EXIT_ON_UNCAUGHT');
  if (exit !== null && !TRUE_RE.test(exit) && !FALSE_RE.test(exit)) {
    warnings.push('EXIT_ON_UNCAUGHT não é true/false; valendo como false.');
  }

  if (!str('OSU_CLIENT_ID') || !secret('OSU_CLIENT_SECRET')) {
    warnings.push('OSU_CLIENT_ID/OSU_CLIENT_SECRET ausentes: consultas ao Bancho oficial vão falhar.');
  }

  if (str('DAYCORE_MYSQL_HOST') && (!str('DAYCORE_MYSQL_USER') || !secret('DAYCORE_MYSQL_PASS'))) {
    warnings.push('DAYCORE_MYSQL_HOST sem DAYCORE_MYSQL_USER/DAYCORE_MYSQL_PASS: o /invitecode vai falhar.');
  }

  if (str('DAYCORE_GUILD_ID') && !str('REDIS_HOST')) {
    warnings.push('DAYCORE_GUILD_ID sem REDIS_HOST: os comandos administrativos não têm como publicar no servidor.');
  }

  return { errors, warnings };
}

/**
 * O `validate()` do boot: avisos vão para o log, erro encerra com código 1.
 * Subir com configuração errada é pior do que não subir — a falha aparece no
 * restart, com a variável nomeada, e não semanas depois num comando.
 */
function assertValid(options) {
  const { errors, warnings } = validate(options);
  for (const warning of warnings) console.warn(`[config] ${warning}`);
  if (errors.length === 0) return;

  for (const error of errors) console.error(`[config] ${error}`);
  console.error(`[config] ${errors.length} problema(s) no .env; corrija e suba de novo.`);
  process.exit(1);
}

// Atribuídos, e não espalhados num objeto novo: `{ ...config }` avaliaria os
// getters uma vez e congelaria o que eles existem para não congelar.
config.validate    = validate;
config.assertValid = assertValid;
config.VARS        = VARS;

module.exports = config;

// `npm run config:check`: confere o `.env` sem subir o bot.
if (require.main === module) {
  const { errors, warnings } = validate();
  for (const warning of warnings) console.log(`aviso: ${warning}`);
  for (const error of errors) console.log(`ERRO:  ${error}`);
  console.log(errors.length === 0 ? 'config ok.' : `${errors.length} erro(s).`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

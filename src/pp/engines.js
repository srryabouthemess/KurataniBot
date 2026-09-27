/**
 * pp/engines.js
 * Qual motor de PP responde por cada servidor.
 *
 * O número que o bot mostra só vale alguma coisa se sair da MESMA conta que o
 * servidor fez: um FC pp ou uma estrela calculados num rework diferente do dele
 * põem na tela um valor que nenhum score daquele servidor teria. Por isso o motor
 * não é um só — cada servidor usa o seu:
 *
 *   Bancho    → o fork do rosu-pp que segue o osu!lazer master (rosu-pp-bancho)
 *   Daycore   → vanilla no fork do rosu-pp, no commit que o bancho.py dele roda
 *               (rosu-pp-daycore); Relax no akatsuki-pp
 *   Akatsuki  → o akatsuki-pp nos dois leaderboards, que é o que o servidor usa
 *
 * Servidor sem rework próprio (EZPP, e todo bancho.py vindo do `.env`) cai no
 * perfil do Daycore: é o bancho.py de referência deste bot, e o rework vanilla
 * dele é o do stable que o resto desses servidores também roda.
 *
 * Os dois builds do rosu-pp são pacotes separados no `vendor/` justamente para
 * poderem andar em ritmos diferentes: o do Bancho acompanha o lazer, o do
 * Daycore só muda quando o servidor muda (ver docs/OPCIONAIS.md).
 */

const servers = require('../servers');

/**
 * `scoreLegado`: se o motor recebe o score total para a estimativa de miss por
 * score. O osu! oficial usa; o bancho.py do Daycore não passa o score para o
 * rosu-pp, então lá só a estimativa por combo opera — e o bot tem de fazer igual
 * para dar o mesmo número num choke.
 */
const MOTORES = {
  bancho:   { id: 'bancho',   tipo: 'rosu',     pacote: 'rosu-pp-bancho',  scoreLegado: true },
  daycore:  { id: 'daycore',  tipo: 'rosu',     pacote: 'rosu-pp-daycore', scoreLegado: false },
  akatsuki: { id: 'akatsuki', tipo: 'akatsuki' },
};

/** Motor do leaderboard vanilla e do de Relax, por perfil de servidor. */
const PERFIS = {
  bancho:   { vn: 'bancho',   rx: 'akatsuki' },
  daycore:  { vn: 'daycore',  rx: 'akatsuki' },
  akatsuki: { vn: 'akatsuki', rx: 'akatsuki' },
};

const PERFIL_PADRAO = 'daycore';

/**
 * Chave do motor no cache em disco.
 *
 * Nos builds do rosu-pp ela leva a versão do pacote, que carrega o commit do
 * fork: a `map_difficulty` não tem TTL, e sem isto uma estrela calculada antes
 * de um rework continuaria sendo servida depois dele. Com a versão na chave, o
 * build novo simplesmente não encontra as linhas do antigo.
 */
function chaveDeCache(motor) {
  if (motor.tipo !== 'rosu') return motor.id;
  try {
    return `${motor.id}@${require(`${motor.pacote}/package.json`).version}`;
  } catch {
    // Sem o pacote não há cálculo nenhum, e portanto nada a gravar com a chave.
    return motor.id;
  }
}

for (const motor of Object.values(MOTORES)) motor.cache = chaveDeCache(motor);

/** O perfil do servidor, ou o padrão para quem não declara um. */
function perfilDe(mode) {
  return PERFIS[servers.get(mode).ppProfile] ?? PERFIS[PERFIL_PADRAO];
}

/**
 * O motor que responde pelo leaderboard `mode`.
 *
 * @returns {{id: string, tipo: 'rosu'|'akatsuki', pacote?: string,
 *            scoreLegado?: boolean, cache: string}}
 */
function motorDe(mode) {
  const perfil = perfilDe(mode);
  return MOTORES[servers.get(mode).relax ? perfil.rx : perfil.vn];
}

module.exports = { MOTORES, PERFIS, PERFIL_PADRAO, motorDe };

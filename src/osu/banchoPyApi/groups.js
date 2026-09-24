/**
 * osu/banchoPyApi/groups.js
 * Os grupos do perfil (selos da Shiina-Web), raspados da página pública.
 */

const metrics = require('../../lib/metrics');
const { dedupe } = require('../../lib/inflight');
const { TtlCache } = require('../../lib/ttlCache');
const { logErrorOnce } = require('../../lib/logger');
const { PRIVATE_MODE, temShiina } = require('./http');
const { getServerProfilePage } = require('./server');

// ─── Grupos do front-end ──────────────────────────────────────────────────────

/** O bloco de grupos, logo abaixo do nick na página de perfil. */
const GRUPO_BLOCO = /<div[^>]*class="[^"]*groupPlace[^"]*"[^>]*>([\s\S]*?)<\/div>/;

/**
 * Cada grupo: um `span.shiina-badge` com um `span.groupEmoji` opcional dentro.
 *
 * Os `[^>]*` precisam aceitar quebra de linha, e aceitam: o HTML vem indentado
 * COM as tags abertas em várias linhas (`<span\n  class="...">`). Um `.` comum
 * no lugar deles casaria só o que estivesse numa linha só — que é como este
 * recorte falhou na primeira tentativa, devolvendo zero grupo numa página que
 * tem três.
 */
const GRUPO_ITEM = /<span[^>]*class="[^"]*shiina-badge[^"]*"[^>]*>\s*(?:<span[^>]*class="[^"]*groupEmoji[^"]*"[^>]*>([\s\S]*?)<\/span>)?\s*([\s\S]*?)<\/span>/g;

/**
 * Os grupos de uma página de perfil: `[{ emoji, name }]`.
 *
 * ── Por que sai do HTML, e não da API ────────────────────────────────────────
 * Grupo é do **Shiina-Web**, não do bancho.py: é uma tabela do front-end, e
 * nenhuma das 62 rotas da API o expõe — nem `/v2/players/{id}`, nem o
 * `custom_badge_name` (que está nulo em todo mundo).
 *
 * E não dá para derivar do `priv`. Medido no Daycore: a yumi tem os bits de
 * ADMINISTRATOR e DEVELOPER e mostra só "puppy" e "Legit"; o noober tem o bit
 * de DEVELOPER e mostra "Nominator" e "Cheating". São conjuntos independentes.
 *
 * O recorte é DENTRO do `groupPlace` de propósito: `shiina-badge` é classe de
 * uso geral do tema e aparece em outros pontos da página.
 */
function parseGroups(html) {
  const bloco = String(html ?? '').match(GRUPO_BLOCO)?.[1];
  if (!bloco) return [];

  return [...bloco.matchAll(GRUPO_ITEM)]
    .map(m => ({
      emoji: (m[1] ?? '').trim(),
      name:  m[2].replace(/<[^>]*>/g, '').trim(),
    }))
    .filter(g => g.name);
}

/**
 * Os grupos daquele jogador, do cache quando possível.
 *
 * Custa uma página inteira de HTML (30-70KB) para ler três palavras, então o
 * cache não é otimização: é o que torna o uso viável. Grupo muda por decisão de
 * staff, o que é raro — meia hora é curto para o dado e longo para a lista, que
 * repete as mesmas pessoas em quase toda linha.
 */
const GRUPOS_TTL_MS = 30 * 60_000;
const GRUPOS_MAX    = 300;
const _grupos = new TtlCache({ ttlMs: GRUPOS_TTL_MS, max: GRUPOS_MAX });

async function getServerPlayerGroups(playerId, mode = PRIVATE_MODE) {
  // Grupo é um selo desenhado pela Shiina-Web, e o que se lê aqui é o HTML dela.
  // Noutro front-end a página existe e responde 200, só que sem os selos: a
  // raspagem devolveria lista vazia depois de baixar 30-70KB por jogador, uma
  // vez por linha do /leaderboard. Quem não tem o conceito não paga por ele.
  if (!temShiina(mode)) return [];

  const chave = `${mode}:${playerId}`;

  const guardado = _grupos.get(chave);
  metrics.cache('gruposJogador', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpgroups:${chave}`, async () => {
    try {
      const grupos = parseGroups(await getServerProfilePage(playerId, mode));
      _grupos.set(chave, grupos);
      return grupos;
    } catch (error) {
      // Falha de rede NÃO entra no cache, e devolve lista vazia: quem chama
      // trata "sem grupo" como "não sei", e não como "está limpo".
      logErrorOnce('banchoPy:grupos', error);
      return [];
    }
  });
}

module.exports = {
  parseGroups,
  getServerPlayerGroups,
};

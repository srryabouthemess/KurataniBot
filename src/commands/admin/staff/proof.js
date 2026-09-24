/**
 * commands/admin/staff/proof.js
 * A prova de posse da conta de jogo: o código do desafio, onde ele é procurado
 * no perfil, e quem pode avalizar um vínculo sem ele. É a parte do /staff que
 * decide quem vira staff — o index.js só conversa com o Discord.
 */

const crypto = require('crypto');

const osu = require('../../../osuClient');
const daycore = require('../../../daycoreAdmin');
const db = require('../../../db');
const { logError, logErrorOnce } = require('../../../lib/logger');

/**
 * Código do desafio.
 *
 * Alfabeto sem 0/O e 1/I/L: quem lê da tela e digita no site erra justamente
 * nesses, e um código recusado por engano manda a pessoa refazer tudo.
 * `randomInt` e não `Math.random`: é o gerador criptográfico, e este código é o
 * que separa "prova de posse" de "chute".
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return `KB-${out}`;
}

/**
 * O que fazer com um pedido de vínculo, dado o que a conta de jogo já tem.
 *
 *   'taken'     — a conta é de outro Discord. Recusa; trocar exige /staff remove
 *                 antes, para a substituição ser um ato explícito.
 *   'unchanged' — o vínculo pedido já existe, idêntico. Emitir desafio aqui
 *                 mandaria provar de novo o que já foi provado, para recriar o
 *                 que já está no banco.
 *   'challenge' — a conta está livre. Emite o código e espera o confirm.
 *
 * @param {object|null} vinculoExistente linha de staff_links daquele osu_id
 * @param {string} memberId Discord que se quer vincular
 */
function decideRegister(vinculoExistente, memberId) {
  if (!vinculoExistente) return 'challenge';
  return vinculoExistente.discord_id === memberId ? 'unchanged' : 'taken';
}

/**
 * O pedaço da página que o DONO da conta escreve.
 *
 * O Shiina-Web marca o bloco do userpage com a classe `userpage`, e só o
 * renderiza quando há texto salvo — conferido em perfis reais: com texto, o
 * bloco existe e contém exatamente o que a pessoa escreveu; sem texto, ele nem
 * aparece no HTML.
 *
 * A varredura conta abertura e fechamento de `<div>` em vez de parar no
 * primeiro `</div>`: o conteúdo é escrito pela pessoa e pode ter div dentro,
 * e cortar no meio deixaria de fora justamente o fim do texto dela.
 *
 * @returns {string|null} null quando não há bloco — que é o caso normal de
 *   quem ainda não salvou nada, e também o sinal de que o tema mudou.
 */
function userpageBlock(html) {
  const abertura = /<div[^>]*class=(["'])[^"']*\buserpage\b[^"']*\1[^>]*>/i.exec(String(html ?? ''));
  if (!abertura) return null;

  const inicio = abertura.index + abertura[0].length;
  const tags = /<(\/?)div\b/gi;
  tags.lastIndex = inicio;

  let profundidade = 1;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    profundidade += m[1] ? -1 : 1;
    if (profundidade === 0) return html.slice(inicio, m.index);
  }

  // Sem fechamento: HTML truncado ou tema diferente. Não dá para dizer onde o
  // bloco termina, então não dá para afirmar que o código está dentro dele.
  return null;
}

/**
 * O código está mesmo no perfil daquela conta — no pedaço que só o dono escreve?
 *
 * Duas fontes:
 *
 *   1. `userpage_content` da API v2. É onde o campo DEVERIA estar — o bancho
 *      declara e seleciona a coluna. Hoje ela vem `null` mesmo com o perfil
 *      preenchido, porque quem grava o userpage é o Shiina-Web e ele guarda
 *      noutro lugar da mesma base. Fica aqui porque, se um dia passarem a
 *      escrever na coluna, este é o caminho certo e mais barato.
 *   2. O BLOCO do userpage dentro da página renderizada.
 *
 * ── Por que não a página inteira ──────────────────────────────────────────────
 * Era assim, e o argumento parecia bom: procurar a string no HTML todo não
 * depende de classe de CSS nem de estrutura, que mudam a cada tema. Só que
 * naquela página cabe muito texto que NÃO é do dono da conta — nome de mapa que
 * ele jogou, clã, o que mais o tema renderizar.
 *
 * E quem emite o desafio é justamente a parte que este fluxo não confia: um
 * administrador do Discord que peça o vínculo de outra pessoa CONHECE o código.
 * Bastava fazê-lo aparecer em qualquer canto daquela página — subindo um mapa
 * com aquele nome e levando o alvo a jogá-lo, por exemplo — para o vínculo ser
 * criado em nome dela. O recorte fecha isso: o bloco do userpage só muda por
 * quem entra na conta.
 *
 * Falha FECHADO, como o resto da porta administrativa. Sem bloco, a resposta é
 * "não confirmado" — e ela está certa nos dois casos possíveis: ou a pessoa
 * ainda não salvou nada, ou o tema mudou e o recorte precisa ser reajustado.
 */
async function codeIsOnProfile(player, code) {
  if (String(player?.userpage_content ?? '').includes(code)) return true;

  let html;
  try {
    html = await osu.getServerProfilePage(player.id);
  } catch (error) {
    // Site fora do ar não é "código ausente", mas o efeito para quem chamou é o
    // mesmo: não dá para confirmar agora. Fica no log para não virar mistério.
    logError('staff:profile', error);
    return false;
  }

  const bloco = userpageBlock(html);
  if (bloco !== null && bloco.includes(code)) return true;

  // O código aparece na página, mas fora do pedaço que o dono escreve. É o
  // sintoma de exatamente duas coisas, e as duas pedem olho humano: o tema mudou
  // (e o recorte não acha mais o bloco), ou alguém plantou o código onde a
  // pessoa não controla. Nenhuma delas pode virar "confirmado", e nenhuma delas
  // deve passar em silêncio — daí o log, uma vez por causa.
  if (html.includes(code)) {
    logErrorOnce('staff:userpage', new Error(
      `o código de ${player.id} aparece na página de perfil, mas fora do bloco do userpage`,
    ));
  }

  return false;
}

/**
 * Quem pode avalizar o vínculo de outra pessoa, dispensando o código.
 *
 * Um DEVELOPER já tem controle total do servidor de jogo — exigir que ele
 * também colete um código de terceiro não protege contra ele, só emperra o
 * caminho legítimo de dar staff a alguém novo. O que o desafio fechou continua
 * fechado: um Administrator do Discord SEM vínculo próprio provado não avaliza
 * nada, e era exatamente por ali que a escalada passava.
 *
 * Duas exigências, e as duas importam:
 *
 *   - o vínculo de quem avaliza precisa ser `proof = 'self'`. Vínculo avalizado
 *     ou legado não serve: senão uma identidade AFIRMADA viraria poder de
 *     afirmar, em cadeia, e quem tivesse explorado o furo antes de ele ser
 *     fechado continuaria com o poder que o furo dava;
 *   - o privilégio é relido do servidor agora, não guardado. Perder DEVELOPER
 *     lá tira o aval aqui na hora, como em todo o resto do bot.
 *
 * @returns {Promise<{osuId: number, osuName: string}|null>}
 */
async function resolveVoucher(discordId) {
  const link = db.getStaffLink(discordId);
  if (!link || link.proof !== 'self') return null;

  const player = await daycore.getPlayerPrivileges(link.osu_id);
  if (!player) return null;
  if (!daycore.hasPriv(player.priv, daycore.Privileges.DEVELOPER)) return null;

  return { osuId: player.id, osuName: player.name };
}

module.exports = {
  // Exportado para teste: é o que separa "prova de posse" de "chute". Um código
  // curto demais, previsível, ou com caracteres que se confundem na digitação
  // estraga a garantia inteira sem aparecer em nenhuma saída do bot.
  generateCode,
  CODE_ALPHABET,

  // Idem: decide entre pedir prova, recusar e não fazer nada. Errar aqui é
  // mandar alguém provar o que já provou, ou pior, deixar passar o que não foi.
  decideRegister,
  resolveVoucher,
  codeIsOnProfile,

  // Exportado para teste: é o recorte que separa o que o dono da conta escreveu
  // do resto da página. Se ele passar a devolver demais, a prova de posse volta
  // a aceitar texto que a pessoa não controla — e nada na tela denunciaria.
  userpageBlock,
};

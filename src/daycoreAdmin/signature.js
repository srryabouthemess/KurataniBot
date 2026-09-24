/**
 * daycoreAdmin/signature.js
 * O motivo que vai para o log do servidor: limpo do que o MySQL dele não guarda,
 * cortado no teto, e assinado com a conta do Discord de quem agiu.
 *
 * Puro — nada de rede —, e é por isso que mora separado das ações.
 */

// ─── Assinatura do autor ──────────────────────────────────────────────────────
/**
 * O `userId` publicado é a conta de jogo do staff — é ela que o bancho grava
 * como autor no log de auditoria dele. Só que quem apertou o botão foi uma
 * conta do **Discord**, e o vínculo entre as duas vive só aqui dentro
 * (`staff_links`, alimentada pelo /staff register).
 *
 * Isso deixava o log do servidor contar meia verdade: quando o vínculo era
 * auto-declarado, quem tinha Administrator no Discord podia apontar a própria
 * conta para o nick de outro staff e agir com o privilégio dele — e a auditoria
 * do servidor culparia o dono da conta, sem nenhum rastro do Discord. O registro
 * que aponta a conta real (`admin_actions`) fica dentro do próprio bot, ou seja,
 * dentro do componente que teria sido comprometido.
 *
 * Anexar o Discord ao motivo faz o log do **servidor** guardar as duas pontas,
 * então a auditoria deixa de depender de o bot estar íntegro.
 *
 * A raiz foi resolvida depois, e este comentário já a descreveu como pendente
 * por mais tempo do que devia: o `/staff register` só emite um código, e quem
 * cria o vínculo é o `/staff confirm`, depois de achar esse código no userpage
 * da conta de jogo — página que só muda por quem entra nela (ver
 * commands/admin/staff.js). A assinatura continua valendo pelo que ela sempre fez: amarrar a
 * ação a uma conta do Discord dentro do log de quem recebeu a ação.
 */
const SIGNATURE_MARK = 'via KurataniBot';

// Teto do que vai publicado. O motivo do usuário é cortado se preciso; a
// assinatura nunca — ela é a parte que a auditoria precisa.
const PUBLISHED_REASON_MAX = 512;

/**
 * Caractere fora do BMP — na prática, todo emoji moderno.
 *
 * ── Por que ele não pode sair daqui ───────────────────────────────────────────
 * O bancho grava o motivo em `logs.msg`, que é `varchar(2048) charset utf8`. E
 * `utf8` no MySQL é o **utf8mb3**: três bytes por caractere, teto em U+FFFF. Um
 * 😀 (U+1F600) precisa de quatro, o INSERT devolve o erro 1366 ("Incorrect
 * string value") e a exceção sobe pela tarefa que escuta o pub/sub — que é o
 * que quem usa vê como "o servidor morre" ao restringir com emoji no motivo.
 *
 * Não dá para consertar a coluna daqui, e nem seria o lugar: quem publica é
 * quem tem de mandar algo que o receptor aguente guardar.
 *
 * ── E o corte, que era o mesmo defeito por outro caminho ──────────────────────
 * Emoji ocupa DUAS posições numa string de JavaScript (o par substituto), e o
 * corte em 512 conta posições. Cortar no meio do par deixa um substituto órfão,
 * que não é UTF-8 válido — e aí o `orjson.loads` do bancho recusa a mensagem
 * inteira, sem nem chegar no banco. Limpar ANTES de cortar resolve os dois: sem
 * par nenhum, não há o que partir ao meio.
 */
const FORA_DO_BMP = /[\u{10000}-\u{10FFFF}]/gu;

/** O que sobra quando o motivo inteiro era emoji — e ele é obrigatório. */
const SEM_MOTIVO = '(sem motivo legível)';

/** Texto que o log do servidor consegue guardar. */
function paraOServidor(texto) {
  return String(texto ?? '')
    // Quebra de linha e controle viram espaço: sem isso um motivo com \n
    // desenha linhas falsas em quem lê o log depois. O linter reclama de
    // caractere de controle em regex justamente porque costuma ser engano —
    // aqui é o alvo.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(FORA_DO_BMP, '')
    // O que sai deixa buraco: "cheat 😀 confirmado" ficaria com dois espaços.
    .replace(/ {2,}/g, ' ')
    .trim();
}

function signReason(reason, actor) {
  const signature = ` | ${SIGNATURE_MARK}: @${paraOServidor(actor.discordName) || '?'} (${actor.discordId})`;

  // A limpeza vem ANTES de neutralizar o marcador, e a ordem é parte da defesa:
  // tirar o emoji de `via 😀KurataniBot` PRODUZ o marcador. Na ordem inversa, um
  // motivo forjaria a segunda assinatura escondendo-a atrás de um emoji.
  const text = paraOServidor(reason)
    // E o próprio marcador é neutralizado, para o motivo não conseguir forjar
    // uma segunda assinatura apontando para outra pessoa.
    .split(SIGNATURE_MARK).join('via-bot')
    || SEM_MOTIVO;

  const room = Math.max(0, PUBLISHED_REASON_MAX - signature.length);
  const clipped = text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text;

  return clipped + signature;
}

module.exports = {
  SIGNATURE_MARK,
  PUBLISHED_REASON_MAX,
  paraOServidor,
  signReason,
};

/**
 * daycoreAdmin/privileges.js
 * Leitura da máscara de privilégios do bancho: quem é staff, que cargos uma
 * conta tem, como cada um se chama, e o menu de cargos do /role.
 *
 * Puro — nada de rede.
 */

const { Privileges } = require('./constants');

/**
 * Quem o bancho considera staff: `STAFF = MODERATOR | ADMINISTRATOR | DEVELOPER`
 * (app/constants/privileges.py). NOMINATOR fica de fora — quem só gerencia mapa
 * não é alvo protegido.
 *
 * ATENÇÃO: isto é MÁSCARA, e o teste é `priv & STAFF` — qualquer um dos bits
 * basta. Não dá para passar no `hasPriv`, que exige o conjunto inteiro: por lá,
 * um Moderator puro não seria reconhecido como staff e a proteção não valeria
 * justamente para quem tem o cargo mais baixo dos três.
 */
const STAFF_MASK = Privileges.MODERATOR | Privileges.ADMINISTRATOR | Privileges.DEVELOPER;

/** Se o bancho trataria essa conta como membro da staff. */
function isStaff(priv) {
  return (Number(priv) & STAFF_MASK) !== 0;
}

// ─── Permissões ───────────────────────────────────────────────────────────────

/**
 * Subconjunto de bits, NÃO hierarquia — e de propósito.
 *
 * É o mesmo teste que o bancho.py faz ao despachar um comando
 * (`player.priv & cmd.priv == cmd.priv`, em app/commands.py). Os docstrings do
 * upstream dizem "manage users (level 1)" e "(level 2)", o que lê como escada,
 * mas nada no servidor implementa isso: quem tem DEVELOPER sem o bit de
 * ADMINISTRATOR também é recusado pelo `!restrict` dentro do jogo.
 *
 * Transformar isto numa hierarquia concederia pelo Discord um acesso que o
 * próprio servidor nega — o oposto do que se quer num comando administrativo.
 */
function hasPriv(priv, flag) {
  return (Number(priv) & flag) === flag;
}

/**
 * Rótulo de exibição de cada bit, do mais alto para o mais baixo.
 *
 * Fonte única do nome: é daqui que sai tanto o texto do `/moderate check`
 * quanto o rótulo das choices do `/role`. Dois lugares com o nome do mesmo bit
 * divergiriam no primeiro que alguém renomeasse.
 *
 * UNRESTRICTED fica de fora de propósito: ele não é cargo, é estado de
 * restrição, e o `/moderate check` já o mostra em campo próprio. Listá-lo aqui
 * faria todo jogador comum aparecer com um "cargo" chamado Unrestricted.
 *
 * VERIFIED fica — mesmo sendo, pela mesma razão acima, um bit que toda conta
 * que já logou tem (bancho.py seta sozinho no primeiro login). A diferença é
 * que o `/role` concede e remove `verified` de propósito, então o
 * `/moderate check` PRECISA conseguir mostrar esse bit específico mudando. Não
 * tire VERIFIED daqui achando que é a mesma limpeza do UNRESTRICTED acima —
 * quem quer um rótulo único sem essa poluição usa `privLabel`, que filtra só
 * ali embaixo.
 */
const PRIV_LABELS = [
  [Privileges.DEVELOPER,       'Developer'],
  [Privileges.ADMINISTRATOR,   'Administrator'],
  [Privileges.MODERATOR,       'Moderator'],
  [Privileges.NOMINATOR,       'Nominator'],
  [Privileges.TOURNEY_MANAGER, 'Tourney Manager'],
  [Privileges.ALUMNI,          'Alumni'],
  [Privileges.PREMIUM,         'Premium'],
  [Privileges.SUPPORTER,       'Supporter'],
  [Privileges.WHITELISTED,     'Whitelisted'],
  [Privileges.VERIFIED,        'Verified'],
];

/** O nome de exibição de um bit isolado. */
function labelOfBit(bit) {
  return PRIV_LABELS.find(([b]) => b === bit)?.[1] ?? String(bit);
}

/**
 * Nomes de cargo como o BANCHO os aceita, para traduzir o que ele publica.
 *
 * Não dá para reaproveitar a tabela ROLES aqui: ela é o menu do `/role`, e o
 * que chega pelo `ex:priv_change` é o que alguém digitou no jogo — inclusive
 * cargo que o `/role` não oferece (`normal`, `supporter`, `premium`).
 *
 * `moderator` e `mod` são o MESMO bit com dois nomes, e isso é do servidor, não
 * daqui: o `str_priv_dict` de `app/commands.py` (in-game) diz `moderator`, e o
 * de `app/api/utils.py` (canais Redis) diz `mod`. Aceitar os dois é o que faz o
 * rótulo sair certo venha o evento de onde vier.
 */
const PRIV_BY_NAME = {
  normal:      Privileges.UNRESTRICTED,
  verified:    Privileges.VERIFIED,
  whitelisted: Privileges.WHITELISTED,
  supporter:   Privileges.SUPPORTER,
  premium:     Privileges.PREMIUM,
  alumni:      Privileges.ALUMNI,
  tournament:  Privileges.TOURNEY_MANAGER,
  nominator:   Privileges.NOMINATOR,
  moderator:   Privileges.MODERATOR,
  mod:         Privileges.MODERATOR,
  admin:       Privileges.ADMINISTRATOR,
  developer:   Privileges.DEVELOPER,
};

/**
 * UNRESTRICTED fica fora de PRIV_LABELS porque ninguém quer lê-lo na lista de
 * cargos de uma conta (ver `privNames`). Aqui o cargo É o assunto da frase —
 * "cargo concedido: 1" não diz nada a ninguém.
 */
const EXTRA_LABELS = { [Privileges.UNRESTRICTED]: 'Unrestricted' };

/**
 * O nome de exibição de um cargo pelo nome que o bancho usa.
 *
 * Nome fora da tabela sai como veio, em minúsculo: o bancho recusa antes de
 * aplicar (`Not found: x.`), então isto é caminho de payload forjado — e mostrar
 * o texto recebido é melhor que inventar um rótulo ou engolir o anúncio.
 */
function labelOfPrivName(name) {
  const chave = String(name).trim().toLowerCase();
  if (!Object.hasOwn(PRIV_BY_NAME, chave)) return chave;

  const bit = PRIV_BY_NAME[chave];
  return PRIV_LABELS.find(([b]) => b === bit)?.[1] ?? EXTRA_LABELS[bit] ?? chave;
}

/**
 * TODOS os cargos ligados, do mais alto para o mais baixo.
 *
 * O `privLabel` devolve só o topo, e para conferir uma concessão isso não
 * serve: quem acabou de receber `whitelisted` sem ter mais nada aparecia no
 * `/moderate check` como "Player", ou seja, o comando não mostrava o que tinha
 * acabado de mudar.
 */
function privNames(priv) {
  const nomes = PRIV_LABELS.filter(([bit]) => hasPriv(priv, bit)).map(([, label]) => label);
  return nomes.length > 0 ? nomes : ['Player'];
}

/**
 * Rótulo de UM cargo só, só para exibição — para frases que pedem um único
 * nome, como "seu cargo lá: **X**" (`admin_missing_priv`, em staffGuard.js) ou
 * "alvo já é staff: X" (`mod_target_is_staff`, em moderate.js e role.js), e os
 * quatro rótulos do /staff (staff.js).
 *
 * NÃO é fonte do texto do `/moderate check` nem dos rótulos das choices do
 * `/role` — isso aqui era verdade do `PRIV_LABELS`/`labelOfBit` ali em cima, e
 * este parágrafo tinha sido copiado de lá por engano. O `/moderate check` lê
 * `privNames` direto (a lista inteira, sem passar por `privLabel`), e as
 * choices do `/role` leem `labelOfBit` direto — nenhum dos dois passa por
 * aqui, então um rótulo esquisito só de `privLabel` não afeta os dois.
 *
 * ── Por que filtra VERIFIED na mão, e UNRESTRICTED nem precisa ─────────────────
 * UNRESTRICTED nunca aparece aqui porque nem está em PRIV_LABELS — `privNames`
 * já não o lista. VERIFIED está, porque é bit real que o /role liga e desliga,
 * e o `/moderate check` precisa mostrar essa mudança. Só que, como estado que
 * toda conta logada tem, é exatamente o mesmo caso de UNRESTRICTED para quem
 * só quer o cargo que distingue a pessoa — daí o filtro aqui, e não em
 * `privNames`: tirar de `privNames` esconderia do `/moderate check` que
 * VERIFIED mudou; tirar só daqui deixa a conta comum (UNRESTRICTED | VERIFIED)
 * de volta como "Player" nas frases de rótulo único, sem afetar quem lê a
 * lista inteira.
 *
 * ── Mudança de comportamento em relação ao antecessor ──────────────────────────
 * O antecessor era uma cadeia if/else que só reconhecia os quatro cargos de
 * staff (DEVELOPER, ADMINISTRATOR, MODERATOR, NOMINATOR) e colapsava tudo mais
 * baixo em "Player". Agora `privLabel` devolve o topo real de `privNames`:
 *   - Quem tem WHITELISTED (mas não nada mais acima) aparecia como "Player",
 *     agora aparece como "Whitelisted".
 *   - Quem tem SUPPORTER ou PREMIUM agora aparece com o cargo, não "Player".
 *   - Quem só tem UNRESTRICTED | VERIFIED — toda conta que já logou —
 *     continua sendo "Player".
 * O `/moderate check` lê assim a priv inteira e identifica o cargo de verdade,
 * sem perder os que ficavam ocultos. O `/moderate restrict` mira em staff
 * definido no servidor (staff mask), então nenhum cargo novo nessa lista o
 * afeta.
 */
function privLabel(priv) {
  return privNames(priv & ~Privileges.VERIFIED)[0];
}

/**
 * Os cargos que o /role distribui: o bit que cada chave liga, e o privilégio
 * que o BOT exige de quem concede.
 *
 * ── A chave sai do str_priv_dict de app/api/utils.py, e isso importa ─────────
 * O bancho.py-ex tem DOIS dicionários com esse nome, e eles divergem: o de
 * app/commands.py chama MODERATOR de "moderator", o de app/api/utils.py chama
 * de "mod". Quem atende o pub/sub é o segundo — os receptores de `addpriv` e
 * `removepriv` importam dali. Publicar "moderator" devolve
 * `Invalid privilege: moderator`, e devolve para o console do bancho: pub/sub
 * não responde a quem publica, então daqui o sintoma seria um "não confirmado"
 * seco, sem pista do motivo.
 *
 * ── Por que o privilégio exigido não é o mesmo para todos ─────────────────────
 * Conceder `developer` dá controle total do servidor. Se ADMINISTRATOR
 * bastasse, um administrador obteria por procuração exatamente o que o bancho
 * não lhe dá — então os três bits de staff exigem DEVELOPER. Os outros cinco
 * param em ADMINISTRATOR porque nenhum deles concede poder sobre outras contas,
 * e travá-los no privilégio mais alto faria o dono virar gargalo para dar
 * nominator a um mapper novo.
 *
 * ── O que NÃO está aqui ───────────────────────────────────────────────────────
 *   supporter, premium — o addpriv recusa os dois (`return "use givedonor."`),
 *     porque o caminho deles é o canal `givedonator`, que leva duração e não
 *     tem contrapartida para remover.
 *   normal — é o bit UNRESTRICTED. Tirá-lo por aqui bane sem passar pelo
 *     Player.restrict(): sem registro de restrição, sem sair das leaderboards,
 *     e o alvo continua aparecendo limpo no /moderate check. Quem bane é o
 *     /moderate restrict.
 */
const ROLES = {
  verified:    { bit: Privileges.VERIFIED,        requires: Privileges.ADMINISTRATOR },
  whitelisted: { bit: Privileges.WHITELISTED,     requires: Privileges.ADMINISTRATOR },
  alumni:      { bit: Privileges.ALUMNI,          requires: Privileges.ADMINISTRATOR },
  tournament:  { bit: Privileges.TOURNEY_MANAGER, requires: Privileges.ADMINISTRATOR },
  nominator:   { bit: Privileges.NOMINATOR,       requires: Privileges.ADMINISTRATOR },
  mod:         { bit: Privileges.MODERATOR,       requires: Privileges.DEVELOPER },
  admin:       { bit: Privileges.ADMINISTRATOR,   requires: Privileges.DEVELOPER },
  developer:   { bit: Privileges.DEVELOPER,       requires: Privileges.DEVELOPER },
};

module.exports = {
  STAFF_MASK,
  isStaff,
  hasPriv,
  labelOfBit,
  labelOfPrivName,
  privNames,
  privLabel,
  ROLES,
  PRIV_BY_NAME,
};

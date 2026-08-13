const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags, PermissionFlagsBits,
} = require('discord.js');

const crypto = require('crypto');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const db = require('../db');
const { t } = require('../i18n');
const { logError } = require('../logger');

// Vale para o tempo de ir ao site, editar o perfil e voltar, sem deixar código
// válido pendurado por horas.
const CHALLENGE_TTL_MS = 30 * 60 * 1000;

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
 * Vincula contas do Discord a contas do Daycore para fins de PERMISSÃO.
 *
 * Por que não reaproveitar o /link: aquele é auto-declarado — só confere que a
 * conta existe, não que quem rodou o comando é dono dela. Serve bem para os
 * comandos de consulta, onde no máximo você vê o PP de outra pessoa. Como base
 * de autorização, deixaria qualquer um do servidor virar administrador do
 * Daycore linkando o nick de um admin.
 *
 * A raiz de confiança aqui é ter **Administrator no Discord do Daycore**. Não é
 * uma permissão qualquer do Discord: o comando só funciona naquele servidor
 * específico (DAYCORE_GUILD_ID), que é controlado por quem administra o
 * Daycore. Em qualquer outro servidor, onde "ser admin" não significa nada, o
 * comando é recusado antes de olhar permissão.
 *
 * ── Prova de posse da conta ───────────────────────────────────────────────────
 * O vínculo já foi auto-declarado: bastava ter Administrator no Discord para
 * apontar o próprio Discord ao nick de outro staff e herdar o privilégio dele.
 * Enquanto o pior caso era uma restrição reversível, a assinatura no motivo
 * (ver `signReason`) bastava como mitigação — dava para agir em nome de outro,
 * mas não sem rastro. Com o /wipe, que apaga scores sem volta, deixou de bastar.
 *
 * Agora são dois passos, e quem cria o vínculo é o segundo:
 *
 *   1. `/staff register` (Administrator) só EMITE um código. Nada é vinculado.
 *   2. A pessoa escreve o código no perfil dela no servidor de jogo e roda
 *      `/staff confirm`. O bot relê o `userpage_content` pela API v2 e, se o
 *      código estiver lá, cria o vínculo.
 *
 * O que isso fecha: o `userpage_content` só é editável por quem entra na conta,
 * então um administrador do Discord não consegue plantar o código no perfil
 * alheio — e portanto não consegue mais se vincular a uma conta que não é dele.
 *
 * As duas pontas ficam provadas: o código prova a posse da conta de jogo, e
 * rodar o `/staff confirm` prova o controle da conta do Discord. O
 * administrador continua sendo quem AUTORIZA (só ele emite o código), mas
 * deixou de ser quem decide sozinho de quem é a conta.
 *
 * O que continua fora do alcance: um administrador pode emitir código para
 * vincular OUTRO Discord a uma conta que aquela pessoa de fato controla. Isso
 * concede privilégio a terceiro, não a si mesmo — e exige a colaboração dela.
 */
module.exports = {
  // Efêmero em tudo: a lista de vínculos diz quem no Discord é quem no jogo, e
  // o register confirma cargo. Em texto a flag some e vira mensagem no canal —
  // ver o comentário em prefix/spec.js.
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Manage which Discord accounts map to Daycore staff accounts')
    .setDescriptionLocalizations({ 'pt-BR': 'Gerencia quais contas do Discord correspondem a contas de staff do Daycore' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    // Esconde o comando de quem não é admin no Discord. É só usabilidade — a
    // checagem que vale é a do execute(), já que permissão default pode ser
    // sobrescrita nas configurações do servidor.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('register')
        .setDescription('Link a Discord member to their Daycore account')
        .setDescriptionLocalizations({ 'pt-BR': 'Vincula um membro do Discord à conta dele no Daycore' })
        .addUserOption(o => o.setName('member')
          .setDescription('Discord member')
          .setDescriptionLocalizations({ 'pt-BR': 'Membro do Discord' })
          .setRequired(true))
        .addStringOption(o => o.setName('player')
          .setDescription('Their Daycore username')
          .setDescriptionLocalizations({ 'pt-BR': 'O nome dele(a) no Daycore' })
          .setRequired(true)
          .setMaxLength(32)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a staff link')
        .setDescriptionLocalizations({ 'pt-BR': 'Remove um vínculo de staff' })
        .addUserOption(o => o.setName('member')
          .setDescription('Discord member').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('confirm')
        .setDescription('Confirm your own link by proving you own the game account')
        .setDescriptionLocalizations({ 'pt-BR': 'Confirma seu próprio vínculo provando que a conta de jogo é sua' }))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all staff links')
        .setDescriptionLocalizations({ 'pt-BR': 'Lista todos os vínculos de staff' })),

  async execute(interaction) {
    const s   = t(interaction);
    const sub = interaction.options.getSubcommand();

    const guildId = process.env.DAYCORE_GUILD_ID;
    if (!guildId) {
      return interaction.reply({ content: s.admin_not_configured, flags: MessageFlags.Ephemeral });
    }
    if (interaction.guildId !== guildId) {
      return interaction.reply({ content: s.admin_wrong_guild, flags: MessageFlags.Ephemeral });
    }

    // ── /staff confirm — o único que NÃO exige Administrator ─────────────────
    // Quem confirma é a pessoa sendo vinculada, provando que a conta de jogo é
    // dela. Exigir Administrator aqui devolveria a decisão a quem o desafio
    // existe justamente para tirar do meio.
    if (sub === 'confirm') {
      const desafio = db.getStaffChallenge(interaction.user.id);
      if (!desafio) {
        return interaction.reply({ content: s.staff_no_challenge, flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const player = await osu.getServerPlayerRaw(desafio.osu_id);
        if (!player) return interaction.editReply(s.player_not_found);

        const userpage = String(player.userpage_content ?? '');
        if (!userpage.includes(desafio.code)) {
          return interaction.editReply(
            s.staff_code_not_found(desafio.osu_name ?? desafio.osu_id, desafio.code),
          );
        }

        // Revalidado na confirmação, e não só na emissão: entre um passo e o
        // outro alguém pode ter vinculado aquela conta de jogo a outro Discord.
        const existente = db.getStaffLinkByOsuId(desafio.osu_id);
        if (existente && existente.discord_id !== interaction.user.id) {
          db.clearStaffChallenge(interaction.user.id);
          return interaction.editReply(
            s.staff_osu_already_linked(existente.discord_id, desafio.osu_name ?? '?', desafio.osu_id),
          );
        }

        db.setStaffLink(interaction.user.id, desafio.osu_id, player.name, desafio.requested_by);
        db.clearStaffChallenge(interaction.user.id);

        const embed = new EmbedBuilder()
          .setColor(0x99ff99)
          .setTitle(s.staff_registered_title)
          .setDescription(
            s.staff_registered_body(
              interaction.user.id, player.name, player.id,
              daycore.privLabel(Number(player.priv ?? 0)),
            ) + `\n\n${s.staff_code_can_be_removed}`,
          );
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        logError('staff:confirm', error);
        return interaction.editReply(s.admin_action_failed);
      }
    }

    // Os demais mexem em vínculo de terceiro: continuam sendo de administrador.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: s.staff_need_admin, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const rows = db.listStaffLinks();
      if (rows.length === 0) {
        return interaction.reply({ content: s.staff_list_empty, flags: MessageFlags.Ephemeral });
      }
      // O register agora recusa duplicata, mas vínculos criados antes disso
      // continuam no banco — e são invisíveis numa lista que só enfileira
      // linhas. Marcar aqui é o que faz alguém notar e resolver.
      const porOsuId = new Map();
      for (const r of rows) porOsuId.set(r.osu_id, (porOsuId.get(r.osu_id) ?? 0) + 1);

      const embed = new EmbedBuilder()
        .setColor(0x99ccff)
        .setTitle(s.staff_list_title)
        .setDescription(rows.map(r =>
          s.staff_list_line(r.discord_id, r.osu_name ?? '?', r.osu_id) +
          (porOsuId.get(r.osu_id) > 1 ? ` ${s.staff_list_duplicate}` : '')).join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const member = interaction.options.getUser('member');

    if (sub === 'remove') {
      const removed = db.removeStaffLink(member.id);
      return interaction.reply({
        content: removed ? s.staff_removed(member.id) : s.staff_nothing_to_remove(member.id),
        flags: MessageFlags.Ephemeral,
      });
    }

    // register
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const name = interaction.options.getString('player');
      const osuId = await osu.resolvePlayerId(name);
      if (!osuId) return interaction.editReply(s.player_not_found);

      const player = await daycore.getPlayerPrivileges(osuId);
      if (!player) return interaction.editReply(s.player_not_found);

      // Um osu! por Discord, e vice-versa. O schema só garante o primeiro lado
      // (a PK é o discord_id), e a falta do segundo já produziu duas contas do
      // Discord vinculadas à mesma conta de staff ao mesmo tempo — duas
      // identidades agindo como a mesma pessoa no log de auditoria do servidor.
      //
      // Recusar em vez de sobrescrever: quem trocou de conta do Discord faz o
      // /staff remove antes, e aí a substituição é um ato explícito de quem
      // administra, não efeito colateral de um register.
      const existente = db.getStaffLinkByOsuId(player.id);

      switch (decideRegister(existente, member.id)) {
        case 'taken':
          return interaction.editReply(
            s.staff_osu_already_linked(existente.discord_id, player.name, player.id),
          );
        case 'unchanged':
          return interaction.editReply(
            s.staff_link_unchanged(member.id, player.name, player.id, daycore.privLabel(player.priv)),
          );
      }

      // Aqui o vínculo NÃO é criado: só emitimos o código. Quem cria é o
      // /staff confirm, depois de o código aparecer no perfil da conta de jogo.
      const code = generateCode();
      db.setStaffChallenge({
        discordId:   member.id,
        osuId:       player.id,
        osuName:     player.name,
        code,
        requestedBy: interaction.user.id,
        ttlMs:       CHALLENGE_TTL_MS,
      });

      // O cargo atual sai como conferência: o vínculo não concede nada por si
      // só — a permissão vem do priv, relido a cada comando.
      const embed = new EmbedBuilder()
        .setColor(0xffcc66)
        .setTitle(s.staff_challenge_title)
        .setDescription(s.staff_challenge_body(
          member.id, player.name, player.id,
          daycore.privLabel(player.priv), code, CHALLENGE_TTL_MS / 60000,
        ));
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('staff', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },

  // Exportado para teste: é o que separa "prova de posse" de "chute". Um código
  // curto demais, previsível, ou com caracteres que se confundem na digitação
  // estraga a garantia inteira sem aparecer em nenhuma saída do bot.
  generateCode,
  CODE_ALPHABET,

  // Idem: decide entre pedir prova, recusar e não fazer nada. Errar aqui é
  // mandar alguém provar o que já provou, ou pior, deixar passar o que não foi.
  decideRegister,
};

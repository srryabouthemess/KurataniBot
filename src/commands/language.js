const { SlashCommandBuilder, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const { SUPPORTED_LANGS, t } = require('../i18n');
const { exigirSubcomando } = require('../subcommands');
const { setUserLang, setServerLang, getUserLang, getServerLang } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Set your language preference / Defina seu idioma')
    .setDescriptionLocalizations({ 'pt-BR': 'Defina seu idioma preferido' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set your personal language')
        .setDescriptionLocalizations({ 'pt-BR': 'Define seu idioma pessoal' })
        .addStringOption(opt =>
          opt
            .setName('lang')
            .setDescription('Language / Idioma')
            .setRequired(true)
            .addChoices(
              { name: 'Português',  value: 'pt' },
              { name: 'English',    value: 'en' },
              { name: 'Русский',    value: 'ru' },
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('server')
        .setDescription('Set the server default language (Admin only)')
        .setDescriptionLocalizations({ 'pt-BR': 'Define o idioma padrão do servidor (apenas Admins)' })
        .addStringOption(opt =>
          opt
            .setName('lang')
            .setDescription('Language / Idioma (leave empty to reset)')
            .setRequired(false)
            .addChoices(
              { name: 'Português',  value: 'pt' },
              { name: 'English',    value: 'en' },
              { name: 'Русский',    value: 'ru' },
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show your current language settings')
        .setDescriptionLocalizations({ 'pt-BR': 'Mostra suas configurações de idioma atuais' })
    ),

  async execute(interaction) {
    // Lança se o subcomando não estiver declarado no builder — ver
    // subcommands.js para o que cada um destes fazia em silêncio antes.
    const sub = exigirSubcomando(module.exports, interaction);
    const s   = t(interaction);

    // ── /language status ───────────────────────────────────────────────────────
    if (sub === 'status') {
      const userLang   = getUserLang(interaction.user.id);
      const serverLang = interaction.guildId ? getServerLang(interaction.guildId) : undefined;

      const userLine   = userLang
        ? s.lang_current_user(SUPPORTED_LANGS[userLang])
        : s.lang_current_none;
      const serverLine = serverLang
        ? s.lang_current_server(SUPPORTED_LANGS[serverLang])
        : '';

      const msg = serverLine ? `${userLine}\n${serverLine}` : userLine;
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    // ── /language set ──────────────────────────────────────────────────────────
    if (sub === 'set') {
      const lang = interaction.options.getString('lang');
      setUserLang(interaction.user.id, lang);
      // Usa o novo idioma escolhido para confirmar
      const newS = t(interaction);
      return interaction.reply({
        content: newS.lang_set(SUPPORTED_LANGS[lang]),
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /language server ───────────────────────────────────────────────────────
    if (sub === 'server') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: s.lang_no_permission, flags: MessageFlags.Ephemeral });
      }

      const lang = interaction.options.getString('lang');

      if (!lang) {
        setServerLang(interaction.guildId, null);
        return interaction.reply({ content: s.lang_reset_server, flags: MessageFlags.Ephemeral });
      }

      setServerLang(interaction.guildId, lang);
      return interaction.reply({
        content: s.lang_set_server(SUPPORTED_LANGS[lang]),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Subcomando que não é nenhum dos três acima.
    //
    // Pelo Discord isto não acontece: ele só envia subcomando declarado no
    // builder. O caso real é o código divergir da declaração — alguém
    // acrescenta um `addSubcommand` e esquece o ramo aqui —, e até agora isso
    // saía como SILÊNCIO: o execute chegava ao fim sem responder, a interação
    // expirava, e quem usou via "O aplicativo não respondeu" sem nada no log.
    //
    // Lançar põe a divergência no log com o nome do subcomando, e o catch do
    // index.js responde o erro genérico traduzido.
    throw new Error(`/language: subcomando sem tratamento: "${sub}"`);
  },
};

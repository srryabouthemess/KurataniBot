const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setUserLang, setServerLang, loadLangData, SUPPORTED_LANGS, t } = require('../i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Set your language preference / Defina seu idioma')
    .setDescriptionLocalizations({ 'pt-BR': 'Defina seu idioma preferido' })
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
    const sub = interaction.options.getSubcommand();
    const s   = t(interaction);

    // ── /language status ───────────────────────────────────────────────────────
    if (sub === 'status') {
      const data       = loadLangData();
      const userLang   = data.users?.[interaction.user.id];
      const serverLang = interaction.guildId ? data.servers?.[interaction.guildId] : undefined;

      const userLine   = userLang
        ? s.lang_current_user(SUPPORTED_LANGS[userLang])
        : s.lang_current_none;
      const serverLine = serverLang
        ? s.lang_current_server(SUPPORTED_LANGS[serverLang])
        : '';

      const msg = serverLine ? `${userLine}\n${serverLine}` : userLine;
      return interaction.reply({ content: msg, ephemeral: true });
    }

    // ── /language set ──────────────────────────────────────────────────────────
    if (sub === 'set') {
      const lang = interaction.options.getString('lang');
      setUserLang(interaction.user.id, lang);
      // Usa o novo idioma escolhido para confirmar
      const newS = t(interaction);
      return interaction.reply({
        content: newS.lang_set(SUPPORTED_LANGS[lang]),
        ephemeral: true,
      });
    }

    // ── /language server ───────────────────────────────────────────────────────
    if (sub === 'server') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: s.lang_no_permission, ephemeral: true });
      }

      const lang = interaction.options.getString('lang');

      if (!lang) {
        setServerLang(interaction.guildId, null);
        return interaction.reply({ content: s.lang_reset_server, ephemeral: true });
      }

      setServerLang(interaction.guildId, lang);
      return interaction.reply({
        content: s.lang_set_server(SUPPORTED_LANGS[lang]),
        ephemeral: true,
      });
    }
  },
};

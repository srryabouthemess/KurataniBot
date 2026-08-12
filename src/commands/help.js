/**
 * commands/help.js
 * O índice do bot: o que dá para fazer e por onde começar.
 *
 * A lista é curada, não derivada de `client.commands`. A coleção traz também os
 * aliases (`/osu`, `/rs`, `/wi`, `/c`, `/choke`) e os administrativos: listados um por
 * linha, dobrariam o tamanho da resposta sem ajudar quem chegou agora. Aqui os
 * aliases aparecem ao lado do comando que eles chamam, e os administrativos só
 * no Discord onde de fato funcionam.
 *
 * Curados são a ORDEM e o agrupamento — os nomes ainda são conferidos contra o
 * que o bot registrou, então um comando removido some daqui em vez de virar uma
 * linha morta apontando para o nada. O outro lado é o `test/help.test.js`: todo
 * comando citado precisa existir e ter descrição nos três idiomas.
 */

const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const servers = require('../servers');
const { PREFIX, ENABLED: PREFIX_ENABLED } = require('../prefix/config');
const { t } = require('../i18n');

/** Os grupos, na ordem em que aparecem. A descrição sai de `help_cmd_<nome>`. */
const GROUPS = [
  { key: 'stats',  commands: ['profile', 'recent', 'topplays', 'score', 'compare'] },
  { key: 'pp',     commands: ['whatif', 'pp', 'simulate'] },
  { key: 'config', commands: ['link', 'language'] },
];

/**
 * Só entra no Discord que o bot administra. Fora dele estes comandos recusam
 * tudo (ver staffGuard.js), então citá-los seria oferecer o que não dá para usar.
 */
const ADMIN_GROUP = { key: 'admin', commands: ['nominate', 'moderate', 'staff'] };

/** Atalhos, mostrados junto do comando de origem em vez de em linha própria. */
const ALIASES = {
  profile: ['osu'],
  recent:  ['rs'],
  score:   ['c', 'choke'],
  whatif:  ['wi'],
};

/** Uma linha do help: nome em negrito, atalhos entre parênteses, descrição. */
function commandLine(name, available, s) {
  const aliases = (ALIASES[name] ?? []).filter(alias => available.has(alias));
  const shown   = aliases.length > 0 ? ` (${aliases.map(a => `\`/${a}\``).join(', ')})` : '';
  return `**/${name}**${shown} — ${s[`help_cmd_${name}`]}`;
}

function fieldFor(group, available, s) {
  const lines = group.commands
    .filter(name => available.has(name))
    .map(name => commandLine(name, available, s));

  if (lines.length === 0) return null;
  return { name: s[`help_group_${group.key}`], value: lines.join('\n'), inline: false };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show what the bot can do')
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra o que o bot faz' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

  async execute(interaction) {
    const s         = t(interaction);
    const available = interaction.client.commands;

    const groups = [...GROUPS];
    const adminGuild = process.env.DAYCORE_GUILD_ID;
    if (adminGuild && interaction.guildId === adminGuild) groups.push(ADMIN_GROUP);

    const fields = groups
      .map(group => fieldFor(group, available, s))
      .filter(Boolean);

    // `choices()` em vez de `all()`: é a mesma lista que a opção `server` dos
    // comandos oferece, então o help não tem como divergir do que é aceito de
    // verdade — inclusive no corte de 25 que o Discord impõe.
    fields.push({
      name:   s.help_servers,
      value:  servers.choices().map(({ name, value }) => `**${name}** \`${value}\``).join('\n'),
      inline: false,
    });

    if (PREFIX_ENABLED) {
      fields.push({ name: s.help_prefix, value: s.help_prefix_body(PREFIX), inline: false });
    }

    const embed = new EmbedBuilder()
      .setTitle(s.help_title)
      .setDescription(s.help_intro)
      .setColor(0xff66aa)
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .addFields(fields)
      .setFooter({ text: s.help_footer });

    // Resposta pública, não ephemeral: help é o tipo de coisa que alguém manda
    // no canal para outra pessoa ver. Também mantém os dois modos iguais — o
    // adaptador do prefixo descarta a flag de ephemeral, que não existe fora
    // de interação (ver prefix/MessageCommand.js).
    return interaction.reply({ embeds: [embed] });
  },

  // Expostos para o teste conferir o catálogo contra os comandos e o i18n.
  catalog: { GROUPS, ADMIN_GROUP, ALIASES },
};

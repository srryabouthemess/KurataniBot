const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { getLink, getPreferredServer } = require('../db');
const { t } = require('../i18n');
const { logError } = require('../logger');

// O Discord mobile NÃO rola code block na horizontal: ele quebra a linha, e
// uma tabela monoespaçada quebrada fica ilegível. A versão antiga tinha 40
// colunas (duas colunas de nome centralizadas em 12 + a de rótulos) e
// quebrava em qualquer celular. Medindo no print de um aparelho real, cabiam
// ~25 colunas — daí o orçamento abaixo.
//
// A economia vem de três lugares: os nomes saíram das colunas (viraram uma
// linha de texto normal, que quebra bem), a coluna da direita não recebe
// preenchimento (nada vem depois dela) e os rótulos foram encurtados.
const MOBILE_WIDTH_BUDGET = 26;

// Nome no cabeçalho da tabela serve só para identificar a coluna; o nome
// completo aparece na linha acima, fora do bloco.
const NAME_COL_MAX = 8;

const short = (str, max) => {
  const value = String(str);
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription("Compare two players' statistics")
    .setDescriptionLocalizations({ 'pt-BR': 'Compara as estatísticas de dois jogadores' })
    // Permite instalar o bot na própria conta (User Install) e usar os
    // comandos em servidores, DM com o bot e DM/grupo entre outros usuários.
    // Requer "User Install" habilitado em Installation no Developer Portal.
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('user1')
        .setDescription('First player (optional if /link is set)')
        .setDescriptionLocalizations({ 'pt-BR': 'Primeiro jogador (opcional se tiver /link)' })
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('user2')
        .setDescription('Second player')
        .setDescriptionLocalizations({ 'pt-BR': 'Segundo jogador' })
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    ),

  async execute(interaction) {
    const s        = t(interaction);
    const manualU1 = interaction.options.getString('user1');
    const manualU2 = interaction.options.getString('user2');
    // Mesma prioridade do resolvePlayer: opção do comando > preferido > padrão
    const mode     = interaction.options.getString('server')
                     || getPreferredServer(interaction.user.id)
                     || osu.DEFAULT_MODE;
    const link     = getLink(interaction.user.id, mode);

    // Prefere o ID numérico: sobrevive a troca de nick no osu!.
    let u1Name = manualU1 ?? (link ? (link.osu_id ?? link.osu_user) : null);
    let u2Name = manualU2;

    if (!u1Name) {
      return interaction.reply({ content: s.compare_need_user1, flags: MessageFlags.Ephemeral });
    }
    if (!u2Name) {
      return interaction.reply({ content: s.compare_need_user2, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      const [u1, u2] = await Promise.all([osu.getUser(u1Name, mode), osu.getUser(u2Name, mode)]);
      if (!u1 || !u2) return interaction.editReply(s.compare_not_found);

      const s1 = u1.statistics;
      const s2 = u2.statistics;

      // Rótulos curtos ('Acc' em vez de 'Accuracy') porque cada caractere aqui
      // sai do orçamento de largura. Continuam em inglês, como já eram: são
      // jargão de osu! e aparecem iguais em qualquer idioma do jogo.
      const statRows = [
        ['Rank',  s1.global_rank,    s2.global_rank,    'rank' ],
        ['PP',    s1.pp,             s2.pp,             'pp'   ],
        ['Acc',   s1.hit_accuracy,   s2.hit_accuracy,   'acc'  ],
        ['Level', s1.level.current,  s2.level.current,  'int'  ],
        ['Combo', s1.maximum_combo,  s2.maximum_combo,  'combo'],
        ['Plays', s1.play_count,     s2.play_count,     'int'  ],
      ];

      const name1 = short(u1.username, NAME_COL_MAX);
      const name2 = short(u2.username, NAME_COL_MAX);

      /**
       * Monta a tabela. `grouping` liga o separador de milhar: ele ajuda a ler
       * número grande, mas custa 2-3 colunas num rank de 7 dígitos — o que
       * estoura o orçamento justamente nas contas do Bancho. Tentamos com ele
       * e só desligamos se não couber.
       */
      const render = (grouping) => {
        const num = (n) => (grouping ? Number(n).toLocaleString(s.locale) : String(n));
        const fmt = (raw, kind) => {
          switch (kind) {
            case 'rank':  return raw ? `#${num(raw)}` : s.profile_unranked;
            case 'pp':    return Number(raw).toFixed(2);
            case 'acc':   return Number(raw).toFixed(2) + '%';
            case 'combo': return num(raw) + 'x';
            default:      return num(raw);
          }
        };

        const cells  = statRows.map(([label, a, b, kind]) => [label, fmt(a, kind), fmt(b, kind)]);
        const labelW = Math.max(...cells.map(c => c[0].length));
        const col1W  = Math.max(name1.length, ...cells.map(c => c[1].length));
        const col2W  = Math.max(name2.length, ...cells.map(c => c[2].length));

        const lines = [
          `${' '.repeat(labelW)} ${name1.padStart(col1W)} | ${name2}`,
          `${'-'.repeat(labelW)}-${'-'.repeat(col1W)}-+-${'-'.repeat(col2W)}`,
          // A coluna da direita não é preenchida: espaço no fim da linha só
          // gastaria largura sem alinhar nada.
          ...cells.map(c => `${c[0].padEnd(labelW)} ${c[1].padStart(col1W)} | ${c[2]}`),
        ];

        return { text: lines.join('\n'), width: Math.max(...lines.map(l => l.length)) };
      };

      let table = render(true);
      if (table.width > MOBILE_WIDTH_BUDGET) table = render(false);

      const embed = new EmbedBuilder()
        .setColor(0x313338)
        .setTitle(s.compare_title)
        // Nomes completos fora do bloco: como texto normal eles quebram linha
        // sem estragar o alinhamento, e assim um nick de 15 caracteres não
        // alarga a tabela inteira.
        .setDescription(`**${u1.username}**  ·  **${u2.username}**\n\`\`\`arm\n${table.text}\n\`\`\``)
        .setFooter({ text: s.compare_footer(interaction.user.username, osu.getModeLabel(mode)) });

      if (u1.avatar_url) embed.setThumbnail(u1.avatar_url);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('compare', error);
      interaction.editReply(s.compare_error);
    }
  },
};

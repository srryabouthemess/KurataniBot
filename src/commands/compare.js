const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const modo = require('../modo');
const { getLink } = require('../db');
const { resolveServer, resolveSecondServer } = require('../userLink');
const { md } = require('../markdown');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

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

/**
 * Encurta para caber na coluna, e tira a crase.
 *
 * Estes nomes vão DENTRO do bloco de código, e ali a contrabarra não escapa
 * nada (ver markdown.js): uma crase no nick fecharia a cerca ``` e o resto da
 * tabela passaria a ser interpretado como markdown. Fora do bloco, os nomes
 * completos passam pelo `md()` como o resto do texto externo.
 */
const short = (str, max) => {
  const value = String(str).replace(/`/g, '');
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
};

module.exports = {
  // Os dois lados perguntam servidor e modo separadamente: o `server2:` é o que
  // deixa comparar jogadores de servidores diferentes, e vazio ele herda o do
  // primeiro lado (ver resolveSecondServer). A ordem importa para o modo texto,
  // que casa token com opção na ordem de declaração — os nicks primeiro.
  data: modo.addOption(modo.addOption(new SlashCommandBuilder()
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
        .setDescription('First player: which server? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Primeiro jogador: qual servidor? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.rootChoices())
    )
    .addStringOption(option =>
      option
        .setName('server2')
        .setDescription("Second player: which server? (default: the first player's)")
        .setDescriptionLocalizations({ 'pt-BR': 'Segundo jogador: qual servidor? (padrão: o do primeiro)' })
        .setRequired(false)
        .addChoices(...servers.rootChoices())
    ),
  { para: { en: 'First player', pt: 'Primeiro jogador' } }),
  { name: 'modo2', para: { en: 'Second player', pt: 'Segundo jogador' } }),

  async execute(interaction) {
    const s        = t(interaction);
    const manualU1 = interaction.options.getString('user1');
    const manualU2 = interaction.options.getString('user2');
    // Mesma resolução do resolvePlayer (opção > preferido > padrão, com o
    // `modo:` aplicado por cima), sem exigir link dos jogadores comparados.
    const mode     = resolveServer(interaction);
    const mode2    = resolveSecondServer(interaction, mode);
    const cruzada  = mode2 !== mode;
    const link     = getLink(interaction.user.id, mode);

    // Prefere o ID numérico: sobrevive a troca de nick no osu!.
    let u1Name = manualU1 ?? (link ? (link.osu_id ?? link.osu_user) : null);
    // Sem `user2` numa comparação cruzada, o segundo lado é a conta do autor no
    // OUTRO servidor: `k!compare -bancho -akatsuki` compara a pessoa com ela
    // mesma nos dois, que é o caso mais direto de um comando cruzado e não pede
    // nick nenhum. No mesmo servidor isso não existe — compararia o autor com o
    // autor —, e ali continua valendo o pedido de sempre.
    const link2 = cruzada && !manualU2 ? getLink(interaction.user.id, mode2) : null;
    let u2Name = manualU2 ?? (link2 ? (link2.osu_id ?? link2.osu_user) : null);

    if (!u1Name) {
      return interaction.reply({ content: s.compare_need_user1, flags: MessageFlags.Ephemeral });
    }
    if (!u2Name) {
      // Numa cruzada o que falta é o link naquele servidor, e não o nick: a
      // mensagem que nomeia o servidor e manda usar `/link set` é a que diz o
      // que fazer. O pedido genérico de nick mandaria digitar o que a pessoa
      // deliberadamente não digitou.
      const content = cruzada ? s.no_link_for_server(osu.getModeLabel(mode2)) : s.compare_need_user2;
      return interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      const [u1, u2] = await Promise.all([osu.getUser(u1Name, mode), osu.getUser(u2Name, mode2)]);
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

      // O rótulo do servidor só aparece quando os dois lados diferem: no caso
      // comum ele seria a mesma palavra repetida duas vezes, e o rodapé já a
      // diz. A tabela continua sem ele de qualquer jeito — o orçamento de
      // largura lá em cima não tem folga para uma palavra por coluna.
      const label1 = osu.getModeLabel(mode);
      const label2 = osu.getModeLabel(mode2);
      const nomeCom = (nome, label) => `**${md(nome)}**${cruzada ? ` (${label})` : ''}`;

      const embed = new EmbedBuilder()
        .setColor(0x313338)
        .setTitle(s.compare_title)
        // Nomes completos fora do bloco: como texto normal eles quebram linha
        // sem estragar o alinhamento, e assim um nick de 15 caracteres não
        // alarga a tabela inteira.
        .setDescription(`${nomeCom(u1.username, label1)}  ·  ${nomeCom(u2.username, label2)}\n\`\`\`arm\n${table.text}\n\`\`\``)
        .setFooter({
          text: s.compare_footer(interaction.user.username, cruzada ? `${label1} vs ${label2}` : label1),
        });

      if (u1.avatar_url) embed.setThumbnail(u1.avatar_url);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('compare', error);
      return safeEditReply(interaction, s.compare_error);
    }
  },

  // `k!compare kuratani ckz -bancho -akatsuki`: a segunda flag de servidor cai
  // no segundo lado. Sem isto o parser gravaria as duas no `server` — as duas
  // opções têm as mesmas choices, e ele resolve pela primeira que casa (ver
  // `transbordo` em prefix/parseArgs.js).
  prefix: {
    flagOverflow: { server: 'server2', modo: 'modo2' },
  },
};

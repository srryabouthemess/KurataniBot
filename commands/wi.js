const { SlashCommandBuilder } = require('discord.js');
const whatif = require('./whatif');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wi')
    .setDescription('Alias for /whatif — simulate pp gain from a hypothetical score')
    .setDescriptionLocalizations({ 'pt-BR': 'Atalho para /whatif — simula ganho de PP com uma play hipotética' })
    .addNumberOption(opt =>
      opt
        .setName('pp')
        .setDescription('Hypothetical PP value (e.g. 400)')
        .setDescriptionLocalizations({ 'pt-BR': 'Valor de PP hipotético (ex: 400)' })
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(30000)
    )
    .addStringOption(opt =>
      opt
        .setName('player')
        .setDescription('Player name (optional if /link is set)')
        .setDescriptionLocalizations({ 'pt-BR': 'Nome do jogador (opcional se tiver /link)' })
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('server')
        .setDescription('Which server to use? (default: official)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: oficial)' })
        .setRequired(false)
        .addChoices(
          { name: 'Bancho',     value: 'official'   },
          { name: 'Daycore',    value: 'private'     },
          { name: 'Daycore RX', value: 'private_rx'  }
        )
    ),

  execute: whatif.execute,
};

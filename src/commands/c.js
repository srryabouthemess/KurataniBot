const score = require('./score');

// Alias de /score — reaproveita as opções já definidas lá (toJSON()) em vez de
// duplicar cada addXOption manualmente, que ficava fácil de desalinhar.
const data = {
  ...score.data.toJSON(),
  name: 'c',
  description: "Alias for /score — show all of a player's scores on a beatmap",
  description_localizations: {
    'pt-BR': 'Atalho para /score — mostra todos os scores de um jogador em um mapa',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: score.execute,
  prefix: score.prefix,
};

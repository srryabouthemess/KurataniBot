const topplays = require('./topplays');

// Alias de /topplays — reaproveita as opções já definidas lá (toJSON()) em vez
// de duplicar cada addXOption manualmente, que ficava fácil de desalinhar
// (ex: mudar a descrição do "server" em topplays.js e esquecer de espelhar aqui).
const data = {
  ...topplays.data.toJSON(),
  name: 'top',
  description: "Alias for /topplays — show a player's top plays",
  description_localizations: {
    'pt-BR': 'Atalho para /topplays — mostra as melhores plays de um jogador',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: topplays.execute,
};

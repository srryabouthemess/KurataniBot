const recent = require('./recent');

// Alias de /recent — reaproveita as opções já definidas lá (toJSON()) em vez
// de duplicar cada addXOption manualmente, que ficava fácil de desalinhar
// (ex: mudar a descrição do "server" em recent.js e esquecer de espelhar aqui).
const data = {
  ...recent.data.toJSON(),
  name: 'rs',
  description: "Alias for /recent — show a player's most recent plays",
  description_localizations: {
    'pt-BR': 'Atalho para /recent — mostra as últimas plays de um jogador',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: recent.execute,
};

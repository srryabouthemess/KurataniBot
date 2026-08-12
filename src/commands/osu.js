const profile = require('./profile');

// Alias de /profile — reaproveita as opções já definidas lá (toJSON()) em vez
// de duplicar cada addXOption manualmente, que ficava fácil de desalinhar
// (ex: mudar a descrição do "server" em profile.js e esquecer de espelhar aqui).
const data = {
  ...profile.data.toJSON(),
  name: 'osu',
  description: "Alias for /profile — show a player's osu! profile",
  description_localizations: {
    'pt-BR': 'Atalho para /profile — mostra o perfil de um jogador de osu!',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: profile.execute,
};

const leaderboard = require('./leaderboard');

// Alias de /leaderboard — reaproveita as opções já definidas lá (toJSON()) em
// vez de duplicar cada addXOption manualmente, que ficava fácil de desalinhar
// (ver rs.js, que é o mesmo desenho).
const data = {
  ...leaderboard.data.toJSON(),
  name: 'lb',
  description: "Alias for /leaderboard — show a server's pp ranking",
  description_localizations: {
    'pt-BR': 'Atalho para /leaderboard — mostra o ranking de pp de um servidor',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: leaderboard.execute,
};

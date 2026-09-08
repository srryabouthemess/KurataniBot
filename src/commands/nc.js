const nochoke = require('./nochoke');

// Alias de /nochoke — reaproveita as opções já definidas lá (toJSON()) em vez de
// duplicar cada addXOption manualmente, que ficava fácil de desalinhar.
const data = {
  ...nochoke.data.toJSON(),
  name: 'nc',
  description: "Alias for /nochoke — top plays re-scored as if every choke had been an FC",
  description_localizations: {
    'pt-BR': 'Atalho para /nochoke — top plays recalculadas como se todo choke tivesse sido FC',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: nochoke.execute,
};

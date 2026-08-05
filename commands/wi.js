const whatif = require('./whatif');

// Alias de /whatif — reaproveita as opções já definidas lá (toJSON()) em vez
// de duplicar cada addXOption manualmente, que ficava fácil de desalinhar
// (ex: mudar o range do "pp" em whatif.js e esquecer de espelhar aqui).
const data = {
  ...whatif.data.toJSON(),
  name: 'wi',
  description: 'Alias for /whatif — simulate pp gain from a hypothetical score',
  description_localizations: {
    'pt-BR': 'Atalho para /whatif — simula ganho de PP com uma play hipotética',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: whatif.execute,
};

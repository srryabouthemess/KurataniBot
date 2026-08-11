const score = require('./score');

// Alias de /score. O nome existe porque é assim que a galera pede ("dá choke
// nesse mapa"): o que se quer ver é o score no mapa junto do PP que ele teria
// com FC, que é exatamente o que o /score mostra.
const data = {
  ...score.data.toJSON(),
  name: 'choke',
  description: "Alias for /score — scores on a beatmap, with the pp they'd be worth on FC",
  description_localizations: {
    'pt-BR': 'Atalho para /score — scores no mapa, com o PP que valeriam com FC',
  },
};

module.exports = {
  data: { name: data.name, toJSON: () => data },
  execute: score.execute,
  prefix: score.prefix,
};

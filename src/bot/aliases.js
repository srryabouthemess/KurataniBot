/**
 * bot/aliases.js
 * Os atalhos de comando, numa tabela só.
 *
 * Cada alias era um arquivo em `commands/` copiando o `toJSON()` do comando de
 * origem e repassando o `execute` — e o que mais cada um lembrasse de repassar.
 * Três repassavam o `prefix` e cinco não: o desalinhamento que o desenho queria
 * evitar voltava por outro lado. Aqui o alias só declara nome e descrição; quem
 * monta o comando é o `loadCommands`, e todos herdam o mesmo conjunto de campos.
 *
 * A ordem importa para o /help: atalhos do mesmo comando aparecem nesta ordem.
 */

module.exports = [
  {
    name: 'osu',
    of:   'profile',
    description: "Alias for /profile — show a player's osu! profile",
    pt:          'Atalho para /profile — mostra o perfil de um jogador de osu!',
  },
  {
    name: 'rs',
    of:   'recent',
    description: "Alias for /recent — show a player's most recent plays",
    pt:          'Atalho para /recent — mostra as últimas plays de um jogador',
  },
  {
    name: 'top',
    of:   'topplays',
    description: "Alias for /topplays — show a player's top plays",
    pt:          'Atalho para /topplays — mostra as melhores plays de um jogador',
  },
  {
    name: 'nc',
    of:   'nochoke',
    description: 'Alias for /nochoke — top plays re-scored as if every choke had been an FC',
    pt:          'Atalho para /nochoke — top plays recalculadas como se todo choke tivesse sido FC',
  },
  {
    name: 'c',
    of:   'score',
    description: "Alias for /score — show all of a player's scores on a beatmap",
    pt:          'Atalho para /score — mostra todos os scores de um jogador em um mapa',
  },
  {
    // O nome existe porque é assim que a galera pede ("dá choke nesse mapa"):
    // o que se quer ver é o score no mapa junto do PP que ele teria com FC,
    // que é exatamente o que o /score mostra.
    name: 'choke',
    of:   'score',
    description: "Alias for /score — scores on a beatmap, with the pp they'd be worth on FC",
    pt:          'Atalho para /score — scores no mapa, com o PP que valeriam com FC',
  },
  {
    name: 'wi',
    of:   'whatif',
    description: 'Alias for /whatif — simulate pp gain from a hypothetical score',
    pt:          'Atalho para /whatif — simula ganho de PP com uma play hipotética',
  },
  {
    name: 'lb',
    of:   'leaderboard',
    description: "Alias for /leaderboard — show a server's pp ranking",
    pt:          'Atalho para /leaderboard — mostra o ranking de pp de um servidor',
  },
];

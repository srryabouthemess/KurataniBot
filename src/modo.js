/**
 * modo.js
 * VN, RX, ou os dois — a dimensão que NÃO é "qual servidor".
 *
 * Um servidor com Relax existe no registro como duas chaves (`daycore` e
 * `daycore_rx`, ver servers.js), e por muito tempo as duas apareceram lado a
 * lado na opção `server:` dos comandos, como se fossem servidores diferentes.
 * Não são: é a mesma conta, o mesmo cadastro e o mesmo link, mudando só o
 * leaderboard que a API entrega. Perguntar as duas coisas no mesmo campo
 * também deixava expressar o contraditório — `server: daycore_rx` com
 * `modo: vn` — e obrigava cada comando a decidir quem ganhava.
 *
 * Agora `server:` pergunta o servidor e `modo:` pergunta o leaderboard. Este
 * módulo é o que as duas respostas têm em comum: as escolhas que o Discord
 * mostra, e a conta de juntá-las numa chave só.
 */

const servers = require('./servers');

const VN = { name: 'VN', value: 'vn', name_localizations: { 'pt-BR': 'VN' } };
const RX = { name: 'RX', value: 'rx', name_localizations: { 'pt-BR': 'RX' } };
// `both` só existe onde dá para mostrar os dois de uma vez, que hoje é o
// /recent e o /rs. Oferecer no /topplays seria prometer uma lista combinada
// que o comando não sabe montar — ele mostra um leaderboard só.
const AMBOS = { name: 'VN+RX', value: 'both', name_localizations: { 'pt-BR': 'Ambos (VN+RX)' } };

const CHOICES       = [VN, RX];
const CHOICES_AMBOS = [VN, RX, AMBOS];

const LABELS = { vn: 'VN', rx: 'RX', both: 'VN+RX' };

/** Rótulo curto de um modo, ou null quando não há preferência nenhuma. */
function label(modo) {
  return LABELS[modo] ?? null;
}

/**
 * A chave de servidor que um modo pede, a partir de qualquer chave do par.
 *
 * `both` cai no vanilla de propósito: quem sabe mostrar os dois leaderboards
 * lê a preferência direto (ver recentMerge.js), e para todos os outros
 * comandos "os dois" não é uma chave que exista — o vanilla é a metade que a
 * pessoa vê quando não dá para ver as duas.
 *
 * Modo nulo devolve a chave como está: é o que mantém de pé quem tem
 * `daycore_rx` salvo de quando o `server:` listava as variantes.
 */
function apply(key, modo) {
  if (modo === 'rx') return servers.relaxKey(key) ?? servers.rootKey(key);
  if (modo === 'vn' || modo === 'both') return servers.rootKey(key);
  return key;
}

/**
 * Acrescenta a opção `modo:` a um builder de comando.
 *
 * Vive aqui, e não copiada em cada comando, porque as escolhas e a descrição
 * precisam dizer a mesma coisa em todos — e porque é dessa lista que o modo
 * texto deriva as flags (`-rx`, `-vn`), então uma divergência entre comandos
 * viraria um atalho que funciona num e não no outro.
 */
function addOption(builder, { ambos = false } = {}) {
  return builder.addStringOption(opt =>
    opt
      .setName('modo')
      .setDescription(ambos
        ? 'VN, RX, or both — for servers that have Relax'
        : 'VN or RX — for servers that have Relax')
      .setDescriptionLocalizations({
        'pt-BR': ambos
          ? 'VN, RX, ou os dois — em servidores que têm Relax'
          : 'VN ou RX — em servidores que têm Relax',
      })
      .setRequired(false)
      .addChoices(...(ambos ? CHOICES_AMBOS : CHOICES))
  );
}

module.exports = { CHOICES, CHOICES_AMBOS, label, apply, addOption };

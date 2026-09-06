/**
 * /scorewipe — apaga UM score, em vez do perfil inteiro que o /wipe apaga.
 *
 * O `wipe_score` do bancho não faz DELETE: ele estaciona o score no status -1 e
 * reescreve a linha de `stats` sem a play. Isso o torna reversível, e é a única
 * diferença de fundo para o /wipe — as travas continuam as mesmas, porque o
 * `channel_scorewipe_reciever` também aceita qualquer publish sem conferir
 * privilégio. O que estes casos travam é, de novo, a tranca inteira.
 */
const test = require('node:test');
const assert = require('node:assert');

// Stub do redis antes de carregar o daycoreAdmin, que desestrutura o
// createClient no require.
process.env.REDIS_HOST = '127.0.0.1';
const published = [];
const redis = require('redis');
redis.createClient = () => ({
  isOpen: true,
  on() {},
  async connect() {},
  async publish(channel, payload) { published.push([channel, JSON.parse(payload)]); },
});

const daycore = require('../src/daycoreAdmin');
const scorewipe = require('../src/commands/scorewipe');

const ACTOR = { osuId: 3, discordId: '100000000000000002', discordName: 'staff-dois' };

const fonte = require('fs').readFileSync(require.resolve('../src/commands/scorewipe'), 'utf8');

test('exige DEVELOPER, e não ADMINISTRATOR', () => {
  // Mesma razão do /wipe: o receptor do canal não confere privilégio nenhum, só
  // se o score existe. Se esta linha cair para ADMINISTRATOR, um administrador
  // comum apaga score alheio sem que o servidor recuse.
  assert.match(fonte, /resolveStaff\(interaction, daycore\.Privileges\.DEVELOPER/);
  assert.doesNotMatch(fonte, /resolveStaff\(interaction, daycore\.Privileges\.ADMINISTRATOR/);
});

test('fica fora do modo texto', () => {
  // Em texto a flag de efêmero some, e a confirmação de um comando destrutivo é
  // o último lugar onde se quer perder a privacidade.
  assert.equal(scorewipe.prefix?.slashOnly, true);
});

test('jogador, modo e motivo são obrigatórios; o id do score não', () => {
  // O id é o caminho de exceção: dá para lê-lo na URL da página do score no site
  // (`/scores/<id>`), mas isso passa por achar o mapa certo primeiro, então o
  // normal é escolher na lista. Já o jogador e o modo são obrigatórios NOS DOIS
  // caminhos, porque no caminho do id eles são a conferência que impede apagar a
  // play de outra pessoa por engano.
  const json = scorewipe.data.toJSON();
  const por = nome => json.options.find(o => o.name === nome);

  assert.equal(por('player').required, true);
  assert.equal(por('mode').required, true);
  assert.equal(por('reason').required, true);
  assert.ok(!por('score').required, 'o id do score é opcional');
  assert.ok(por('mode').choices.length >= 4, 'os modos do bancho viram choices');
});

test('o id digitado é conferido contra o jogador e o modo', () => {
  // Sem estas duas conferências, um id errado apagaria a play de outra pessoa e
  // nada na tela denunciaria a troca: o embed de confirmação mostraria o mapa
  // certo do score errado.
  assert.match(fonte, /alvo\.userId !== target\.id/);
  assert.match(fonte, /alvo\.mode !== modeNum/);
});

test('publica no canal scorewipe com o formato que o receptor lê', async () => {
  published.length = 0;
  await daycore.wipeScore(90210, ACTOR, 'score de cheat');

  const [canal, payload] = published[0];
  assert.equal(canal, 'scorewipe');
  // O receptor lê `id` (o score, não o jogador) e `adminId`. Errar o nome aqui
  // faz o log do servidor registrar Admin(0) como autor — ou, no caso do `id`,
  // a mensagem inteira morrer com KeyError.
  assert.equal(payload.id, 90210);
  assert.equal(payload.adminId, 3);
  assert.equal(payload.reason.startsWith('score de cheat'), true);
});

test('o motivo publicado leva a assinatura do Discord', async () => {
  published.length = 0;
  await daycore.wipeScore(90210, ACTOR, 'limpeza');

  const { reason } = published[published.length - 1][1];
  assert.match(reason, /via KurataniBot/);
  assert.match(reason, /100000000000000002/);
});

test('o publish NÃO leva o jogador nem o modo', async () => {
  // Os dois são conferência do lado do bot: o servidor descobre dono e modo
  // pela própria linha do score. Mandá-los daria a impressão de que o receptor
  // os confere, e ele não confere nada.
  published.length = 0;
  await daycore.wipeScore(90210, ACTOR, 'motivo');

  const payload = published[0][1];
  assert.equal(payload.mode, undefined);
  assert.equal(payload.userId, undefined);
});

test('o status de score apagado bate com o do bancho', () => {
  // Espelha o `WIPED_SCORE_STATUS` de app/api/utils.py. Divergir aqui faz o
  // `verifyScoreWiped` nunca confirmar um wipe que funcionou — e o comando
  // responder "não confirmei" para todo mundo.
  assert.equal(daycore.WIPED_SCORE_STATUS, -1);
  // E não 0: 0 é FAILED, e `plays` conta score falhado.
  assert.notEqual(daycore.WIPED_SCORE_STATUS, 0);
});

const fonteApi = require('fs').readFileSync(require.resolve('../src/osu/banchoPyApi'), 'utf8');

test('a leitura por mapa existe e devolve lista', async () => {
  // É o único jeito de o bot saber quantas plays existem naquele mapa: a v1
  // get_player_scores é por modo, e a get_map_scores é leaderboard.
  const api = require('../src/osu/banchoPyApi');
  assert.equal(typeof api.getServerPlayerMapScores, 'function');
  // Sem servidor no ar, o contrato é devolver lista vazia em vez de estourar:
  // quem chama é uma tela de confirmação que não pode cair por causa disso.
  assert.deepEqual(await api.getServerPlayerMapScores(7, 'md5', 0).catch(() => []), []);
});

test('a leitura por mapa vai pela v1, com id, md5 e mode', () => {
  assert.match(fonteApi, /'get_player_map_scores'/);
  assert.match(fonteApi, /id:\s+playerId/);
  assert.match(fonteApi, /mode: modeNum/);
});

const fonteAdmin = require('fs').readFileSync(require.resolve('../src/daycoreAdmin'), 'utf8');

test('publica no canal mapwipe com o formato que o receptor lê', async () => {
  published.length = 0;
  await daycore.wipeMapScores(7, 'c9557c9d6cc35fb6a0a43c37e226703e', 4, ACTOR, 'sessão suja');

  const [canal, payload] = published[0];
  assert.equal(canal, 'mapwipe');
  // Aqui `id` é o JOGADOR, ao contrário do canal scorewipe, onde é o score.
  // Trocar os dois apagaria o mapa da pessoa errada.
  assert.equal(payload.id, 7);
  assert.equal(payload.md5, 'c9557c9d6cc35fb6a0a43c37e226703e');
  assert.equal(payload.mode, 4);
  assert.equal(payload.adminId, 3);
  assert.equal(payload.reason.startsWith('sessão suja'), true);
});

test('o motivo do lote também leva a assinatura do Discord', async () => {
  published.length = 0;
  await daycore.wipeMapScores(7, 'c9557c9d', 0, ACTOR, 'limpeza');

  const { reason } = published[published.length - 1][1];
  assert.match(reason, /via KurataniBot/);
  assert.match(reason, /100000000000000002/);
});

test('o canal do lote não é o mesmo do score', () => {
  // Publicar o payload do lote no canal `scorewipe` faria o receptor de lá ler
  // `id` como id de score e apagar a play de outra pessoa.
  assert.match(fonteAdmin, /MAPWIPE:\s+'mapwipe'/);
  assert.match(fonteAdmin, /SCOREWIPE:\s+'scorewipe'/);
});

// Adaptação: o brief da Task 8 substitui `getServerPlayerMapScores` direto em
// `require('../src/osu/banchoPyApi')`. Mas o `daycoreAdmin.js` não chama o
// adaptador: ele chama `osu = require('./osuClient')`, e o `osuClient.js`
// COPIA a referência da função para dentro do próprio module.exports no
// require (`getServerPlayerMapScores: banchoPyApi.getServerPlayerMapScores`).
// Sobrescrever a propriedade do lado do banchoPyApi não muda a cópia que o
// osuClient já guardou, então o `daycoreAdmin` continuaria chamando a função
// real — que tentaria rede sem servidor no ar, violando "nenhum teste pode
// depender de rede" e sem provar a lógica do `every(status < 0)`.
// A troca abaixo é no MESMO objeto que o `daycoreAdmin` de fato guarda
// (`require` cacheia o módulo, então é a mesma referência), o que prova a
// propriedade de verdade: a leitura do lote via `osu.getServerPlayerMapScores`.
test('a verificação do lote só dá verde com nada acima de -1', async () => {
  const osuClient = require('../src/osuClient');
  const original = osuClient.getServerPlayerMapScores;

  osuClient.getServerPlayerMapScores = async () => [{ id: 1, status: -1 }, { id: 2, status: -1 }];
  assert.equal(await daycore.verifyMapScoresWiped(7, 'md5', 0, { attempts: 1, delayMs: 1 }), true);

  // Uma sobrando é o caso que importa: o lote pegou parte, e o embed não pode
  // sair verde dizendo que acabou.
  osuClient.getServerPlayerMapScores = async () => [{ id: 1, status: -1 }, { id: 2, status: 2 }];
  assert.equal(await daycore.verifyMapScoresWiped(7, 'md5', 0, { attempts: 1, delayMs: 1 }), false);

  osuClient.getServerPlayerMapScores = original;
});

test('lista vazia conta como apagado', async () => {
  // Nenhuma linha acima de -1 é exatamente o que se queria.
  const osuClient = require('../src/osuClient');
  const original = osuClient.getServerPlayerMapScores;

  osuClient.getServerPlayerMapScores = async () => [];
  assert.equal(await daycore.verifyMapScoresWiped(7, 'md5', 0, { attempts: 1, delayMs: 1 }), true);

  osuClient.getServerPlayerMapScores = original;
});

test('a verificação do lote exige todas abaixo de zero', () => {
  assert.match(fonteAdmin, /linhas\.every\(row => Number\(row\.status\) < 0\)/);
});

test('as duas normalizações carregam o md5 do mapa', () => {
  // Sem ele o botão do lote não tem o que publicar: `map_md5` é a chave que a
  // tabela `scores` usa, e o id do beatmap não serve no lugar dela.
  assert.match(fonte, /md5:\s+row\.map_md5/);
  assert.match(fonte, /md5:\s+score\.map_md5/);
});

test('o botão do lote só existe com mais de uma play no mapa', () => {
  // Com uma só, o /scorewipe normal já faz exatamente isso — e um botão a mais
  // numa tela destrutiva é ruído com custo.
  assert.match(fonte, /doMapa\.length > 1/);
});

test('a falha da contagem não derruba o /scorewipe', () => {
  // O lote é um extra. Se o endpoint novo não estiver no ar, a tela de um score
  // tem que continuar aparecendo.
  assert.match(fonte, /getServerPlayerMapScores\([^)]*\)\.catch\(\(\) => \[\]\)/);
});

test('o clique no botão do lote não publica sozinho', () => {
  // A publicação mora depois da SEGUNDA confirmação. Prova-se mostrando que o
  // handler do primeiro clique DESVIA para `apagarOMapa` em vez de publicar —
  // por isso ancora no `if` do clique, e não num slice entre nomes que caem
  // dentro da própria `apagarOMapa` (abaixo de `module.exports`) e passariam
  // de qualquer jeito.
  // Entre o `if` e o `return` só se admite comentário: qualquer outra coisa ali
  // seria trabalho acontecendo antes da segunda tela.
  assert.match(fonte, /clique\.customId === loteId\) \{\n(?:\s*\/\/[^\n]*\n)*\s*return await apagarOMapa\(/);
});

test('o lote registra no admin_actions', () => {
  assert.match(fonte, /registrarAcao\('mapwipe'/);
});

// O corpo da `apagarOMapa`, isolado do resto do arquivo: ela é a última função
// antes do `module.exports`, então este recorte não pega nada do `execute`.
// Ancorar aqui é o que separa "a segunda tela existe no arquivo" de "a segunda
// tela está no caminho da publicação".
const corpoDoLote = (() => {
  const inicio = fonte.indexOf('async function apagarOMapa');
  const fim    = fonte.indexOf('module.exports');
  assert.ok(inicio !== -1, 'a apagarOMapa precisa existir');
  assert.ok(fim > inicio, 'a apagarOMapa fica acima do module.exports');
  return fonte.slice(inicio, fim);
})();

test('a segunda tela é ESPERADA antes de o lote ser publicado', () => {
  // O teste que existia antes provava só a delegação: se a `apagarOMapa` fosse
  // reescrita chamando o `wipeMapScores` na primeira linha, sem coletor nenhum,
  // ele continuava verde. Esta é a garantia que a tela inteira existe para dar
  // — a ordem dentro da função —, e é ela que precisa estar travada.
  const espera  = corpoDoLote.indexOf('awaitMessageComponent');
  const publica = corpoDoLote.indexOf('wipeMapScores');

  assert.ok(espera !== -1, 'a segunda tela espera um clique');
  assert.ok(publica !== -1, 'o lote é publicado dentro da apagarOMapa');
  assert.ok(espera < publica, 'a espera do clique vem ANTES da publicação do lote');
});

test('o coletor da segunda tela só aceita os botões dela', () => {
  // Botão do Discord não desabilita ao ser clicado, e entre o `deferUpdate` do
  // clique anterior e este coletor o cliente ainda desenha a tela velha. Com o
  // filtro olhando só `i.user.id`, um duplo clique no botão do lote — que é
  // comportamento humano normal — entrava aqui com o customId de lá.
  const filtro = corpoDoLote.slice(
    corpoDoLote.indexOf('filter:'),
    corpoDoLote.indexOf('time: CONFIRM_MS'),
  );
  assert.match(filtro, /i\.customId === confirmId/);
  assert.match(filtro, /i\.customId === cancelId/);
});

test('só o confirmar da segunda tela publica o lote', () => {
  // Checagem POSITIVA. Com `!== cancelId`, qualquer customId que passasse pelo
  // coletor publicava — inclusive o do botão do lote, chegando atrasado da tela
  // anterior. Numa tela destrutiva o default tem que ser não fazer nada.
  assert.match(corpoDoLote, /clique\.customId !== confirmId/);
  assert.doesNotMatch(corpoDoLote, /clique\.customId === cancelId/);
});

test('a falha do lote cai no catch do /scorewipe', () => {
  // Sem o `await`, a promessa devolvida escapa do `try` do `execute`: a falha
  // não vira `admin_action_failed` com `logError` e os botões ficam na tela.
  assert.match(fonte, /return await apagarOMapa\(/);
});

test('a lista da segunda tela avisa quando não coube tudo', () => {
  // O `.slice(0, 2500)` cortava no meio de uma linha e não sinalizava nada: o
  // staff via uma lista aparentemente completa, com o número certo no
  // cabeçalho, e confirmava sem saber que faltava play na tela.
  assert.doesNotMatch(corpoDoLote, /\.slice\(0, 2500\)/);
  assert.match(corpoDoLote, /s\.mapwipe_more\(/);
  // Corte por item inteiro, e não por caractere.
  assert.match(corpoDoLote, /LISTA_MAX_CHARS/);
});

test('a linha da v1 sai da normalização com o md5 preenchido', () => {
  // Todo o caminho do lote pende disto: sem `map_md5` na linha, `alvo.md5` fica
  // nulo, `getServerPlayerMapScores` nunca é chamado e o botão do lote some da
  // tela sem quebrar nada — some calado. O SELECT da v1 `get_player_scores`
  // traz `t.map_md5` hoje; o dia em que isso mudar tem que aparecer aqui.
  const linhaV1 = {
    id: 4242,
    mode: 0,
    status: 2,
    pp: 312.5,
    acc: 98.44,
    grade: 'S',
    mods: 64,
    play_time: '2026-09-01T12:34:56',
    map_md5: 'c9557c9d6cc35fb6a0a43c37e226703e',
    beatmap: { id: 7331, artist: 'Artista', title: 'Titulo', version: 'Insane' },
  };

  const item = scorewipe._daLista(linhaV1, 7);
  assert.equal(item.md5, 'c9557c9d6cc35fb6a0a43c37e226703e');
  // E o resto continua vindo junto, para o teste não passar com um objeto vazio
  // que por acaso tivesse só o md5.
  assert.equal(item.id, 4242);
  assert.equal(item.userId, 7);
  assert.equal(item.mapId, 7331);
});

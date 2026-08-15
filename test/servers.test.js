/** Registro de servidores: leitura do .env, nomes antigos, choices. */
const os = require('os');
const test = require('node:test');
const assert = require('node:assert');

// O servers.js chama dotenv.config(), que lê o .env do diretório atual. Rodando
// a partir da pasta do projeto, ele repovoaria as variáveis que cada caso apaga
// de propósito.
process.chdir(os.tmpdir());

const SERVERS_PATH = require.resolve('../src/servers');

// O modo texto resolve `-ezpp` por aqui: a flag não diz qual opção preenche, e
// sim o valor, e é este casamento que descobre.
const { matchChoice } = require('../src/prefix/coerce');

/**
 * Recarrega o registro com um ambiente controlado.
 *
 * `BUILTIN_SERVERS` vazio por padrão: estes casos verificam a LEITURA do .env, e
 * quais servidores vêm de fábrica é outra decisão. Sem desligar, acrescentar um
 * embutido quebraria testes que não têm nada a ver com ele — foi o que
 * aconteceu quando o Akatsuki entrou.
 */
function load(env) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SERVER_') || ['SERVERS', 'OSU_MODE', 'PRIVATE_SERVER_URL', 'BUILTIN_SERVERS'].includes(key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, { BUILTIN_SERVERS: '', ...env });
  delete require.cache[SERVERS_PATH];
  return require('../src/servers');
}

test('configuração nova', async t => {
  const servers = load({
    SERVERS: 'daycore',
    SERVER_DAYCORE_URL: 'https://daycore.org',
    SERVER_DAYCORE_RELAX: 'true',
    OSU_MODE: 'daycore',
  });

  await t.test('o oficial está sempre presente', () => {
    assert.equal(servers.get('official').kind, 'official');
  });

  await t.test('label padrão vem da chave', () => {
    assert.equal(servers.get('daycore').label, 'Daycore');
  });

  await t.test('URLs derivadas do domínio', () => {
    const s = servers.get('daycore');
    assert.equal(s.banchoV2, 'https://api.daycore.org/v2');
    assert.equal(s.avatars,  'https://a.daycore.org');
    // A api do front-end (Shiina-Web) fica no domínio do site, não no api.
    assert.equal(s.webApi,   'https://daycore.org/api/v1');
  });


  await t.test('RX é entrada própria, com a mesma conta', () => {
    assert.equal(servers.get('daycore_rx').label, 'Daycore RX');
    assert.equal(servers.get('daycore_rx').gameMode, 4);
    assert.equal(servers.namespace('daycore_rx'), servers.namespace('daycore'));
  });

  await t.test('choices saem na ordem de configuração', () => {
    assert.deepEqual(servers.choices(), [
      { name: 'Bancho',     value: 'official' },
      { name: 'Daycore',    value: 'daycore' },
      { name: 'Daycore RX', value: 'daycore_rx' },
    ]);
  });

  await t.test('OSU_MODE define o padrão', () => {
    assert.equal(servers.defaultKey(), 'daycore');
  });

  await t.test('chaves antigas continuam resolvendo', () => {
    assert.equal(servers.resolveKey('private'),    'daycore');
    assert.equal(servers.resolveKey('private_rx'), 'daycore_rx');
    assert.equal(servers.namespace('private'),     'daycore');
  });

  await t.test('chave desconhecida cai no padrão', () => {
    assert.equal(servers.get('naoexiste').key, 'daycore');
  });

  await t.test('keyForNamespace é o caminho de volta', () => {
    assert.equal(servers.keyForNamespace('daycore'), 'daycore');
  });
});

test('vários servidores convivem', async t => {
  const servers = load({
    SERVERS: 'daycore,akatsuki',
    SERVER_DAYCORE_URL: 'https://daycore.org',
    SERVER_AKATSUKI_URL: 'https://akatsuki.gg',
    SERVER_AKATSUKI_LABEL: 'Akatsuki',
    SERVER_AKATSUKI_RELAX: 'true',
  });

  await t.test('cada um com seu namespace', () => {
    assert.equal(servers.all().length, 4);
    assert.notEqual(servers.namespace('daycore'), servers.namespace('akatsuki'));
  });

  await t.test('sem RELAX não existe variante', () => {
    assert.equal(servers.has('daycore_rx'), false);
  });

  await t.test('o nome antigo aponta para o primeiro', () => {
    assert.equal(servers.resolveKey('private'), 'daycore');
  });

  await t.test('label explícito ganha do padrão', () => {
    assert.equal(servers.label('akatsuki'), 'Akatsuki');
  });

  await t.test('sem OSU_MODE o padrão é o oficial', () => {
    assert.equal(servers.defaultKey(), 'official');
  });
});

test('configuração antiga (PRIVATE_SERVER_URL)', async t => {
  const servers = load({
    PRIVATE_SERVER_URL: 'https://daycore.org',
    OSU_MODE: 'private',
  });

  await t.test('vira servidor com a chave tirada do domínio', () => {
    assert.ok(servers.has('daycore'));
  });

  await t.test('mantém o RX ligado, como era antes', () => {
    assert.ok(servers.has('daycore_rx'));
  });

  await t.test('OSU_MODE=private continua valendo', () => {
    assert.equal(servers.defaultKey(), 'daycore');
  });

  await t.test('api key não é mais guardada', () => {
    // Nenhum endpoint usado pede autenticação; credencial parada só circula.
    assert.equal(servers.get('daycore').apiKey, undefined);
  });
});

test('entradas inválidas não derrubam as válidas', async t => {
  const servers = load({
    SERVERS: 'semurl,official,com-hifen,ok',
    SERVER_OK_URL: 'https://ok.example',
  });

  await t.test('servidor sem URL é ignorado', () => {
    assert.equal(servers.has('semurl'), false);
  });

  await t.test('"official" é reservado', () => {
    assert.equal(servers.get('official').kind, 'official');
  });

  await t.test('chave com caractere inválido é ignorada', () => {
    assert.equal(servers.has('com-hifen'), false);
  });

  await t.test('o válido entra mesmo com vizinhos ruins', () => {
    assert.ok(servers.has('ok'));
  });
});

// ─── Front-end do servidor ───────────────────────────────────────────────────
// Nem todo bancho.py roda a Shiina-Web, e o rank global e as plays saem dela.
// `webApi: null` é como o registro diz "este não tem", e o adaptador então
// busca as duas coisas no próprio bancho.py.
//
// Cada caso recarrega o registro, então isto vive num teste separado: o `load`
// limpa o `process.env`, e o `defaultKey` lê o OSU_MODE na hora da chamada —
// chamar `load` no meio de outro bloco apaga o padrão dos casos seguintes dele.

test('front-end declarado no .env', async t => {
  await t.test('SERVER_<chave>_WEB=none marca servidor sem Shiina-Web', () => {
    const s = load({ SERVERS: 'outro', SERVER_OUTRO_URL: 'https://outro.org', SERVER_OUTRO_WEB: 'none' });
    assert.equal(s.get('outro').webApi, null);
    // O resto do endereçamento não muda: só o front-end saiu.
    assert.equal(s.get('outro').banchoV1, 'https://api.outro.org/v1');
  });

  await t.test('ausente, o padrão da Shiina-Web continua valendo', () => {
    const s = load({ SERVERS: 'outro', SERVER_OUTRO_URL: 'https://outro.org' });
    assert.equal(s.get('outro').webApi, 'https://outro.org/api/v1');
  });

  await t.test('também aceita um endereço próprio', () => {
    const s = load({ SERVERS: 'outro', SERVER_OUTRO_URL: 'https://outro.org', SERVER_OUTRO_WEB: 'https://front.outro.org/api/v1/' });
    // Barra do fim removida — quem chama concatena `/endpoint`, e a dobrada
    // daria 404 em todo pedido.
    assert.equal(s.get('outro').webApi, 'https://front.outro.org/api/v1');
  });
});

// ─── Servidores embutidos ────────────────────────────────────────────────────
// O osu! oficial é fixo porque é um só. O Akatsuki vem de fábrica por ser
// grande e ter API pública estável — mas dá para desligar, senão quem hospeda o
// bot para outro servidor carregaria um concorrente na lista de escolhas.

test('embutidos', async t => {
  // O `load` desliga os embutidos por padrão; aqui o assunto é justamente eles.
  const comEmbutidos = () => {
    const s = load({});
    delete process.env.BUILTIN_SERVERS;
    delete require.cache[SERVERS_PATH];
    void s;
    return require('../src/servers');
  };

  await t.test('o Akatsuki vem por padrão, com a variante RX', () => {
    const s = comEmbutidos();
    assert.equal(s.get('akatsuki').kind, 'ripple');
    assert.equal(s.get('akatsuki_rx').relax, true);
  });

  await t.test('Relax do Ripple é outro eixo, não o modo 4', () => {
    // No bancho.py, Relax é o "modo 4". No Ripple são dois campos: mode segue 0
    // e rx vira 1. Deduzir um do outro daria o leaderboard errado.
    const s = comEmbutidos();
    assert.equal(s.get('akatsuki_rx').gameMode, 0);
    assert.equal(s.get('akatsuki_rx').rx, 1);
  });

  await t.test('bancho.py continua pedindo Relax pelo modo 4', () => {
    const s = load({ SERVERS: 'daycore', SERVER_DAYCORE_URL: 'https://daycore.org', SERVER_DAYCORE_RELAX: 'true' });
    assert.equal(s.get('daycore_rx').gameMode, 4);
    assert.equal(s.get('daycore_rx').rx, 0);
  });

  await t.test('o EZPP vem por padrão, com a variante RX', () => {
    const s = comEmbutidos();
    assert.equal(s.get('ezpp').kind, 'banchopy');
    assert.equal(s.get('ezpp').label, 'EZPP');
    assert.equal(s.get('ezpp_rx').relax, true);
    // bancho.py: Relax é o modo 4, ao contrário do Ripple logo acima.
    assert.equal(s.get('ezpp_rx').gameMode, 4);
  });

  await t.test('a chave curta é a que se digita, e o label acompanha', () => {
    // No modo texto a flag sai do label (`-ezpp`, `-ezpprx`), e é ele que a
    // mensagem de erro sugere. Um label "EZPP Farm" esconderia o atalho.
    const s = comEmbutidos();
    assert.equal(s.get('ezpp_rx').label, 'EZPP RX');
    const nomes = s.choices().map(c => c.name);
    assert.ok(nomes.includes('EZPP') && nomes.includes('EZPP RX'), nomes.join(', '));
  });

  await t.test('o EZPP declara que não tem Shiina-Web', () => {
    // É o que manda o adaptador buscar rank e plays no próprio bancho.py. Sem
    // isto, as duas coisas iriam para `ez-pp.farm/api/v1`, que responde 200 com
    // o HTML da página — e a falha seria muda, não um erro.
    const s = comEmbutidos();
    assert.equal(s.get('ezpp').webApi, null);
    assert.equal(s.get('ezpp').banchoV1, 'https://api.ez-pp.farm/v1');
    assert.equal(s.get('ezpp').banchoV2, 'https://api.ez-pp.farm/v2');
    assert.equal(s.get('ezpp').avatars,  'https://a.ez-pp.farm');
    // A variante RX é o mesmo cadastro: herda o endereço e o namespace.
    assert.equal(s.get('ezpp_rx').webApi, null);
    assert.equal(s.namespace('ezpp_rx'), s.namespace('ezpp'));
  });

  await t.test('o nome antigo ainda resolve', () => {
    const s = comEmbutidos();
    assert.equal(s.resolveKey('ezppfarm'), 'ezpp');
    assert.equal(s.resolveKey('ezppfarm_rx'), 'ezpp_rx');
  });

  await t.test('dá para desligar', () => {
    const s = load({ BUILTIN_SERVERS: '' });
    assert.equal(s.has('akatsuki'), false);
    assert.equal(s.has('ezpp'), false);
    // O alias não pode sobreviver ao embutido: sem a conferência, `has` diria
    // que sim e o `get` devolveria o padrão como se fosse o EZPP.
    assert.equal(s.has('ezppfarm'), false);
    assert.equal(s.get('official').kind, 'official', 'o oficial não é um embutido opcional');
  });

  await t.test('dá para ligar só um deles', () => {
    const s = load({ BUILTIN_SERVERS: 'ezpp' });
    assert.equal(s.has('ezpp'), true);
    assert.equal(s.has('akatsuki'), false);
  });

  await t.test('as flags do modo texto são as curtas', () => {
    // O que a pessoa digita: `k!rs fulano -ezpp`. A flag não diz qual opção
    // está preenchendo, e sim o valor — é o matchChoice que descobre.
    const s = comEmbutidos();
    const def = { choices: s.choices() };

    assert.equal(matchChoice(def, 'ezpp')?.value, 'ezpp');
    // Sem underline: a chave é `ezpp_rx`, e quem digita não põe o traço. Casa
    // pelo label "EZPP RX" sem espaço.
    assert.equal(matchChoice(def, 'ezpprx')?.value, 'ezpp_rx');
    // Maiúsculas não atrapalham.
    assert.equal(matchChoice(def, 'EZPP')?.value, 'ezpp');
    // O prefixo comum não faz um cair no outro: `-ezpp` é o vanilla, e só.
    assert.equal(matchChoice(def, 'akatsuki')?.value, 'akatsuki');
    assert.equal(matchChoice(def, 'ezppfarm'), undefined, 'o label antigo não é mais uma flag');
  });

  await t.test('embutido desconhecido é ignorado com aviso, não derruba', () => {
    const s = load({ BUILTIN_SERVERS: 'naoexiste' });
    assert.equal(s.has('naoexiste'), false);
    assert.equal(s.get('official').kind, 'official');
  });
});

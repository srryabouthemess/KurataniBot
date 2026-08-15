/**
 * Prova de posse da conta de jogo antes de vincular.
 *
 * O `/staff register` nasceu auto-declarado: bastava ter Administrator no
 * Discord para apontar o próprio Discord ao nick de outro staff e herdar o
 * privilégio dele. Enquanto o pior caso era uma restrição reversível, a
 * assinatura no motivo bastava como mitigação. Com o `/wipe`, que apaga scores
 * sem volta, deixou de bastar.
 *
 * O desafio quebra a cadeia num ponto específico: o `userpage_content` só é
 * editável por quem entra na conta, então quem não controla a conta não
 * consegue plantar o código lá — e o vínculo não sai.
 *
 * Roda contra um bot.db descartável, apontado por `KURATANI_DATA_DIR`.
 *
 * Antes isto copiava `src/db.js`, `servers.js` e `paths.js` para um diretório
 * temporário que reproduzia o layout do projeto, porque o caminho do banco saía
 * de `src/` e não havia como desviá-lo. A cópia amarrava o teste à LISTA de
 * arquivos do módulo — e foi exatamente o que quebrou quando o `db.js` virou
 * uma pasta. Com o diretório de dados configurável, o teste usa os módulos de
 * verdade e só troca onde o arquivo é gravado.
 */
const test = require('node:test');
const assert = require('node:assert');

const { freshDb: workspace } = require('./helpers');

const DESAFIO = {
  discordId: '100000000000000001',
  osuId: 6,
  osuName: 'conta-de-jogo',
  code: 'KB-ABC12345',
  requestedBy: '100000000000000002',
  ttlMs: 30 * 60 * 1000,
};

test('o desafio guardado é lido de volta', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);

  const lido = db.getStaffChallenge(DESAFIO.discordId);
  assert.equal(lido.osu_id, 6);
  assert.equal(lido.code, 'KB-ABC12345');
  assert.equal(lido.requested_by, DESAFIO.requestedBy);
});

test('emitir de novo substitui, em vez de acumular', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);
  db.setStaffChallenge({ ...DESAFIO, osuId: 3, osuName: 'nunca', code: 'KB-ZZZ99999' });

  // Dois códigos válidos ao mesmo tempo, apontando para contas diferentes,
  // deixariam o antigo servir para vincular a conta errada.
  const lido = db.getStaffChallenge(DESAFIO.discordId);
  assert.equal(lido.osu_id, 3);
  assert.equal(lido.code, 'KB-ZZZ99999');
});

test('desafio expirado é o mesmo que inexistente', t => {
  const db = workspace(t);
  db.setStaffChallenge({ ...DESAFIO, ttlMs: -1 });

  assert.equal(db.getStaffChallenge(DESAFIO.discordId), null);
  // E some do banco na leitura, em vez de ficar esperando alguém tentar usar.
  assert.equal(db.clearStaffChallenge(DESAFIO.discordId), false);
});

test('cada Discord tem o seu, sem vazar para o outro', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);

  assert.equal(db.getStaffChallenge('999999999999999999'), null);
});

test('o desafio sozinho não vincula nada', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);

  // É o ponto da mudança: emitir o código não concede acesso. Só o confirm,
  // depois de conferir o perfil, chama o setStaffLink.
  assert.equal(db.getStaffLink(DESAFIO.discordId), null);
});

test('o código não usa caracteres que se confundem na digitação', () => {
  const { CODE_ALPHABET } = require('../src/commands/staff');

  // Quem lê da tela e digita no site erra justamente nestes, e um código
  // recusado por engano manda a pessoa refazer tudo.
  for (const char of '01OIL') {
    assert.ok(!CODE_ALPHABET.includes(char), `${char} não deveria estar no alfabeto`);
  }
});

test('o código tem forma estável e não se repete', () => {
  const { generateCode, CODE_ALPHABET } = require('../src/commands/staff');
  const forma = new RegExp(`^KB-[${CODE_ALPHABET}]{8}$`);

  const vistos = new Set();
  for (let i = 0; i < 500; i++) {
    const code = generateCode();
    assert.match(code, forma);
    vistos.add(code);
  }

  // 31^8 combinações: repetir em 500 sorteios indicaria gerador degenerado —
  // o caso em que "prova de posse" vira "chute".
  assert.equal(vistos.size, 500, 'houve código repetido em 500 sorteios');
});

// ─── Quando pedir a prova, e quando não pedir ────────────────────────────────
// A pergunta que motivou isto: um staff JÁ registrado, sendo registrado de novo
// pelo dono, precisa colocar o código no perfil outra vez? Não deve — seria
// provar de novo o que já foi provado, para recriar o que já está no banco.

test('conta livre pede a prova', () => {
  const { decideRegister } = require('../src/commands/staff');
  assert.equal(decideRegister(null, '111'), 'challenge');
});

test('vínculo idêntico não pede nada', () => {
  const { decideRegister } = require('../src/commands/staff');
  const existente = { discord_id: '111', osu_id: 6 };
  assert.equal(decideRegister(existente, '111'), 'unchanged');
});

test('conta de outro Discord é recusada, não sobrescrita', () => {
  // O caso que o furo original explorava: apontar o próprio Discord para a
  // conta de outro staff.
  const { decideRegister } = require('../src/commands/staff');
  const existente = { discord_id: '999', osu_id: 6 };
  assert.equal(decideRegister(existente, '111'), 'taken');
});

test('trocar de conta de jogo ainda pede a prova da nova', () => {
  // @X vinculado a osu 13 e sendo registrado em osu 6, que está livre: o
  // getStaffLinkByOsuId(6) devolve null, então a prova é exigida — a conta nova
  // nunca foi provada por ninguém.
  const { decideRegister } = require('../src/commands/staff');
  assert.equal(decideRegister(null, '111'), 'challenge');
});

// ─── Aval: quem dispensa o código, e quem não dispensa ───────────────────────
// Exigir o código de todo vínculo novo cobrava o preço no lugar errado: dar
// staff a alguém passava a depender de a pessoa estar online. Quem já provou a
// própria conta E é DEVELOPER no jogo cria o vínculo direto.
//
// O que a escalada usava era Administrator no Discord SEM privilégio no jogo, e
// é esse caso que precisa continuar recusado.

const daycorePath = require.resolve('../src/daycoreAdmin');
const dbPath      = require.resolve('../src/db');

/** Carrega o staff.js com db e daycoreAdmin trocados. */
function comMocks({ link, priv }) {
  const daycoreReal = require('../src/daycoreAdmin');

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { getStaffLink: () => link },
  };
  require.cache[daycorePath] = {
    id: daycorePath, filename: daycorePath, loaded: true,
    exports: {
      ...daycoreReal,
      getPlayerPrivileges: async () => (priv === null ? null : { id: 6, name: 'kyou', priv }),
    },
  };

  delete require.cache[require.resolve('../src/commands/staff')];
  return require('../src/commands/staff');
}

const P = require('../src/daycoreAdmin').Privileges;
const DEV   = P.UNRESTRICTED | P.VERIFIED | P.DEVELOPER;
const ADMIN = P.UNRESTRICTED | P.VERIFIED | P.ADMINISTRATOR;

test('DEVELOPER com vínculo provado avaliza', async () => {
  const staff = comMocks({ link: { osu_id: 6, proof: 'self' }, priv: DEV });
  assert.notEqual(await staff.resolveVoucher('111'), null);
});

test('vínculo legado não avaliza, mesmo sendo DEVELOPER', async () => {
  // Os vínculos do dono e do kyou são deste tipo. Aceitá-los deixaria quem
  // tivesse explorado o furo antes de ele ser fechado seguir com aquele poder.
  const staff = comMocks({ link: { osu_id: 6, proof: null }, priv: DEV });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('vínculo avalizado não avaliza outro', async () => {
  // Sem isto, uma identidade AFIRMADA viraria poder de afirmar, em cadeia.
  const staff = comMocks({ link: { osu_id: 6, proof: 'vouch' }, priv: DEV });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('provado mas sem DEVELOPER não avaliza', async () => {
  const staff = comMocks({ link: { osu_id: 6, proof: 'self' }, priv: ADMIN });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('quem não tem vínculo nenhum não avaliza', async () => {
  // O caso exato da escalada: Administrator no Discord, nada no jogo.
  const staff = comMocks({ link: null, priv: DEV });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('conta que sumiu do servidor não avaliza', async () => {
  const staff = comMocks({ link: { osu_id: 6, proof: 'self' }, priv: null });
  assert.equal(await staff.resolveVoucher('111'), null);
});

// ─── Onde o código é procurado ───────────────────────────────────────────────
// O `userpage_content` da API v2 é onde o campo DEVERIA estar, e vem null mesmo
// com o perfil preenchido: quem grava o userpage é o Shiina-Web, e ele guarda
// noutro lugar da mesma base. Medido contra um perfil real com o código salvo.

const osuPath = require.resolve('../src/osuClient');

function comPerfil({ html, erro = null }) {
  const osuReal = require('../src/osuClient');
  require.cache[osuPath] = {
    id: osuPath, filename: osuPath, loaded: true,
    exports: {
      ...osuReal,
      getServerProfilePage: async () => {
        if (erro) throw erro;
        return html;
      },
    },
  };
  delete require.cache[require.resolve('../src/commands/staff')];
  return require('../src/commands/staff');
}

test('acha o código na página renderizada', async () => {
  const staff = comPerfil({ html: '<div class="userpage">KB-VSEBUPGE</div>' });
  assert.equal(await staff.codeIsOnProfile({ id: 13, userpage_content: null }, 'KB-VSEBUPGE'), true);
});

test('página sem o código recusa', async () => {
  const staff = comPerfil({ html: '<div class="userpage">outra coisa</div>' });
  assert.equal(await staff.codeIsOnProfile({ id: 13, userpage_content: null }, 'KB-VSEBUPGE'), false);
});

test('o campo da API ainda vale, se um dia for preenchido', async () => {
  // Sem chamar a página: é o caminho mais barato, e continua correto.
  const staff = comPerfil({ erro: new Error('não deveria ter buscado a página') });
  assert.equal(await staff.codeIsOnProfile({ id: 13, userpage_content: 'KB-VSEBUPGE' }, 'KB-VSEBUPGE'), true);
});

test('site fora do ar recusa em vez de estourar', async () => {
  // Não é "código ausente", mas o efeito para quem chamou é o mesmo: não dá
  // para confirmar agora. O que não pode é derrubar o comando.
  const staff = comPerfil({ erro: new Error('ECONNREFUSED') });
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await staff.codeIsOnProfile({ id: 13, userpage_content: null }, 'KB-VSEBUPGE'), false);
  } finally {
    console.error = original;
  }
});

// ─── E onde ele NÃO pode ser aceito ──────────────────────────────────────────
// A busca era na página inteira, e naquela página cabe muito texto que não é do
// dono da conta: nome de mapa que ele jogou, clã, o que o tema renderizar. Quem
// emite o desafio é justamente a parte que este fluxo não confia — e ela CONHECE
// o código. Bastava fazê-lo aparecer em qualquer canto da página para o vínculo
// ser criado em nome de outra pessoa.

/** Página como o Shiina-Web monta: userpage é um bloco no meio do resto. */
const paginaCom = ({ userpage = null, resto = '' }) => `
  <html><body>
    <div class="profile-header"><h1>Profile of alvo</h1></div>
    ${userpage === null ? '' : `<div class="p-2 userpage mx-1 border rounded mb-2">${userpage}</div>`}
    <div class="recent-plays">${resto}</div>
  </body></html>`;

test('código fora do bloco do userpage NÃO confirma', async () => {
  // O ataque: o admin que pediu o vínculo sobe um mapa com o nome do código e
  // leva o alvo a jogá-lo. O código aparece na página, mas o dono da conta
  // nunca escreveu nada.
  const staff = comPerfil({
    html: paginaCom({ userpage: 'meu perfil', resto: 'jogou KB-VSEBUPGE [Insane]' }),
  });

  const original = console.error;
  console.error = () => {};   // o desvio é logado de propósito; aqui só não polui
  try {
    assert.equal(
      await staff.codeIsOnProfile({ id: 13, userpage_content: null }, 'KB-VSEBUPGE'),
      false,
      'aceitou um código plantado fora do que o dono da conta escreve',
    );
  } finally {
    console.error = original;
  }
});

test('perfil sem userpage nenhum recusa, mesmo com o código na página', async () => {
  // Perfil vazio não renderiza o bloco — conferido em contas reais do Daycore.
  // Sem bloco, "não confirmado" é a resposta certa: ou a pessoa não salvou nada,
  // ou o tema mudou. As duas falham fechado.
  const staff = comPerfil({ html: paginaCom({ userpage: null, resto: 'KB-VSEBUPGE' }) });

  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await staff.codeIsOnProfile({ id: 13, userpage_content: null }, 'KB-VSEBUPGE'), false);
  } finally {
    console.error = original;
  }
});

test('o bloco sobrevive a div dentro do userpage', async () => {
  // O conteúdo é escrito pela pessoa e pode ter div: parar no primeiro </div>
  // cortaria o texto dela no meio, e o código depois do corte seria recusado.
  const staff = comPerfil({
    html: paginaCom({ userpage: '<div class="box"><b>oi</b></div> KB-VSEBUPGE' }),
  });

  assert.equal(await staff.codeIsOnProfile({ id: 13, userpage_content: null }, 'KB-VSEBUPGE'), true);
});

test('o recorte devolve só o que está dentro do bloco', async () => {
  const { userpageBlock } = require('../src/commands/staff');

  const bloco = userpageBlock(paginaCom({ userpage: 'DENTRO', resto: 'FORA' }));
  assert.ok(bloco.includes('DENTRO'));
  assert.ok(!bloco.includes('FORA'));

  // Sem bloco e sem fechamento, devolve null — e o chamador recusa.
  assert.equal(userpageBlock(paginaCom({ userpage: null })), null);
  assert.equal(userpageBlock('<div class="userpage">sem fechar'), null);
  assert.equal(userpageBlock(''), null);
});

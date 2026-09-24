/**
 * A direção das dependências dentro de `src/`.
 *
 * A reorganização em pastas (lib/, pp/, osu/, daycoreAdmin/, commands/<grupo>/)
 * só vale enquanto as setas continuarem apontando para o mesmo lado. Nada
 * quebra quando uma delas vira: o `osu/` que passa a importar `discord.js`, ou
 * o comando que passa a importar um pedaço de outro, funcionam perfeitamente —
 * e é assim que uma estrutura se desfaz, um require razoável de cada vez.
 *
 * As regras são listas de quem PODE, e não de quem não pode: um arquivo novo
 * nasce sob a regra mais estrita, e soltá-la é uma decisão escrita aqui.
 *
 * (Quem lê o `process.env` é conferido à parte, no config.test.js.)
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'src');

// ─── O grafo ──────────────────────────────────────────────────────────────────

/** Caminho relativo a `src/`, sempre com `/`. */
const rel = file => path.relative(SRC, file).split(path.sep).join('/');

function listar(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listar(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** O arquivo a que um require relativo leva, como o Node resolveria. */
function resolver(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/**
 * O código sem os comentários — eles citam `require('./x')` ao explicar o
 * desenho, e isso não é dependência. O `//` precedido de `:` fica (é URL).
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** arquivo → { internos: [rel], pacotes: [nome] } */
const GRAFO = new Map();
for (const file of listar(SRC)) {
  const fonte = semComentarios(fs.readFileSync(file, 'utf8'));
  const internos = new Set();
  const pacotes = new Set();

  for (const [, spec] of fonte.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (spec.startsWith('.')) {
      const alvo = resolver(file, spec);
      assert.ok(alvo, `${rel(file)}: require('${spec}') não resolve`);
      internos.add(rel(alvo));
    } else {
      pacotes.add(spec);
    }
  }

  GRAFO.set(rel(file), { internos: [...internos], pacotes: [...pacotes] });
}

const dentro = (file, ...prefixos) => prefixos.some(p => (p.endsWith('/') ? file.startsWith(p) : file === p));

/** Quem viola: [{ de, para }] para toda aresta em que `proibido(de, para)`. */
function arestas(proibido) {
  const achadas = [];
  for (const [de, { internos, pacotes }] of GRAFO) {
    for (const para of [...internos, ...pacotes.map(p => `pkg:${p}`)]) {
      if (proibido(de, para)) achadas.push(`${de} → ${para}`);
    }
  }
  return achadas;
}

// ─── As peças puras dos comandos ──────────────────────────────────────────────
// Um comando que virou pasta separa a conta (e o texto) do Discord justamente
// para os testes poderem exercitá-la sem montar interação nenhuma.
const PECA_PURA = /^commands\/.+\/(logic|format|messages|limits)\.js$/;

// ─── As regras ────────────────────────────────────────────────────────────────

test('o grafo foi montado (senão as regras abaixo passariam por vacuidade)', () => {
  assert.ok(GRAFO.size > 50, `só ${GRAFO.size} arquivos em src/`);
  assert.ok(GRAFO.get('index.js').internos.length > 5, 'o index.js deveria importar vários módulos');
});

test('lib/ e config.js não importam nada de dentro do bot', () => {
  // São a base: se o logger precisar do db, o db não pode mais logar.
  const violacoes = arestas((de, para) =>
    dentro(de, 'lib/', 'config.js') && !para.startsWith('pkg:'));
  assert.deepEqual(violacoes, []);
});

test('só a camada do Discord importa discord.js', () => {
  // Dados, APIs de osu!, motor de PP e a administração do servidor não sabem
  // que existe um Discord: são eles que um dia poderiam servir a outra coisa, e
  // são eles que os testes exercitam sem montar interação.
  const PODE = [
    'index.js', 'bot/', 'commands/', 'prefix/', 'prefixCommands.js',
    'pagination.js', 'subcommands.js', 'announce.js',
  ];
  const violacoes = arestas((de, para) =>
    para === 'pkg:discord.js' && (!dentro(de, ...PODE) || PECA_PURA.test(de)));
  assert.deepEqual(violacoes, []);
});

test('só quem fala com o usuário importa o i18n', () => {
  // Texto traduzido é coisa de resposta. Quem produz dado devolve dado (ou uma
  // chave), e quem responde escolhe o idioma — o announce.js, por exemplo,
  // recebe as strings prontas em vez de resolver o idioma sozinho.
  const PODE = ['index.js', 'commands/', 'prefixCommands.js', 'userLink.js'];
  const violacoes = arestas((de, para) =>
    para.startsWith('i18n/') && !de.startsWith('i18n/') && (!dentro(de, ...PODE) || PECA_PURA.test(de)));
  assert.deepEqual(violacoes, []);
});

test('um comando não importa peças de outro comando', () => {
  // O que dois comandos compartilham sobe para fora de commands/ (o hits.js
  // nasceu assim, do /topif e do /nochoke). Senão mexer num quebra o outro, e
  // nada no nome do arquivo avisa.
  //
  // A raiz de um comando é a pasta dele (`commands/osu/topif/`) ou o próprio
  // arquivo (`commands/osu/pp.js`).
  const raiz = file => {
    const [, grupo, nome] = file.split('/');
    return `commands/${grupo}/${nome.replace(/\.js$/, '')}`;
  };
  const violacoes = arestas((de, para) =>
    para.startsWith('commands/') && (!de.startsWith('commands/') || raiz(de) !== raiz(para)));
  assert.deepEqual(violacoes, []);
});

test('nenhum ciclo de require', () => {
  // Ciclo no CommonJS não dá erro: um dos lados recebe o module.exports ainda
  // pela metade, e a função que "não existe" só aparece quando é chamada.
  const ciclos = [];
  const visto = new Set();
  const pilha = [];
  const naPilha = new Set();

  const visitar = no => {
    visto.add(no);
    pilha.push(no);
    naPilha.add(no);
    for (const dep of GRAFO.get(no)?.internos ?? []) {
      if (naPilha.has(dep)) ciclos.push([...pilha.slice(pilha.indexOf(dep)), dep].join(' → '));
      else if (!visto.has(dep)) visitar(dep);
    }
    pilha.pop();
    naPilha.delete(no);
  };
  for (const no of GRAFO.keys()) if (!visto.has(no)) visitar(no);

  assert.deepEqual(ciclos, []);
});

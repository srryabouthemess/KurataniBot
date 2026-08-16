/**
 * gerar-notices.js — reconstrói o THIRD-PARTY-NOTICES.md a partir das dependências.
 *
 * ── Por que existe ────────────────────────────────────────────────────────────
 * MIT, BSD e Apache pedem a mesma coisa: quem redistribui o software leva junto
 * o aviso de copyright e o texto da licença de cada peça de terceiro. Um arquivo
 * escrito à mão cumpre isso no dia em que é escrito e mente no primeiro
 * `npm install` seguinte — daí ele ser GERADO. `npm run notices` depois de mexer
 * em dependência, e o diff mostra o que entrou ou saiu.
 *
 * ── De onde sai a lista ───────────────────────────────────────────────────────
 * Do `package-lock.json`, e não do `node_modules`: o lock traz as dependências
 * opcionais das DUAS plataformas (o binário do lazer-calculator é win32-x64
 * aqui e linux-x64 na VPS), então o arquivo sai igual em qualquer máquina em vez
 * de depender de onde foi gerado. O lock também já carrega o campo `license` de
 * cada pacote, que é o que o npm leu do `package.json` publicado.
 *
 * O TEXTO da licença, esse só existe no pacote instalado. Pacote que a
 * plataforma atual não instala, ou que simplesmente não publica um arquivo de
 * licença, vai para uma seção própria com o identificador declarado e o
 * repositório — dizer "não acompanha o texto" é honesto; inventar um aviso de
 * copyright que ninguém escreveu, não.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'THIRD-PARTY-NOTICES.md');

/** Nomes de arquivo que costumam guardar licença ou aviso. */
const ARQUIVO_LICENCA = /^(LICENSE|LICENCE|COPYING|NOTICE)([-.].*)?$/i;

/**
 * O que o bot usa e o npm não vê — mantido à mão, porque não há de onde ler.
 *
 * O lock cobre o que o `npm install` baixa, e isso não é tudo: a lib Python do
 * PP do Relax é instalada por fora, e as imagens em `assets/` vieram do jogo. As
 * duas são de terceiro do mesmo jeito, e nenhuma aparece se este arquivo esperar
 * o npm contar.
 *
 * Mexeu aqui? Acrescente a entrada; o gerador só a imprime.
 */
const FORA_DO_NPM = [
  {
    titulo:    'akatsuki-pp-py — MIT',
    corpo: [
      'Calcula o PP das plays de **Relax**, que usa outro sistema de PP. É opcional e',
      'quem opera o bot instala na própria máquina (veja [`docs/OPCIONAIS.md`](docs/OPCIONAIS.md)),',
      'então o repositório não a redistribui — mas ela é dependência do código do mesmo',
      'jeito: [`src/pp_calc.py`](src/pp_calc.py) a importa, e sem ela o PP do RX sai como `?pp`.',
      '',
      'De Max Ohn e tsunyoku — <https://github.com/osuAkatsuki/akatsuki-pp-py>.',
    ],
    texto: [
      'MIT License',
      '',
      'Copyright (c) 2021 Max',
      '',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
      'of this software and associated documentation files (the "Software"), to deal',
      'in the Software without restriction, including without limitation the rights',
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
      'copies of the Software, and to permit persons to whom the Software is',
      'furnished to do so, subject to the following conditions:',
      '',
      'The above copyright notice and this permission notice shall be included in all',
      'copies or substantial portions of the Software.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
      'SOFTWARE.',
    ].join('\n'),
  },
  {
    titulo: 'Ícones de grade em `assets/emojis/` — osu!, CC BY-NC 4.0',
    corpo: [
      'Os oito PNGs (`ranking-A.png` … `ranking-XH.png`) são da **skin oficial do osu!**,',
      'de ppy Pty Ltd. Eles viram os emojis de grade das plays — o bot não os desenhou.',
      '',
      'O código do osu! é MIT, **os recursos do jogo não**: eles saem sob',
      '[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), conforme',
      '[ppy/osu-resources](https://github.com/ppy/osu-resources). O que essa licença pede,',
      'e este arquivo cumpre, é **atribuição**; o que ela proíbe é **uso comercial**.',
      '',
      '> Enquanto o bot for gratuito, como é hoje, os ícones podem ficar. Se um dia ele',
      '> cobrar por qualquer coisa, eles são a primeira peça a sair — e o bot sobrevive',
      '> à saída deles: sem os arquivos, a grade volta a ser texto (`**A**`), que é como',
      '> era antes.',
      '',
      'A marca "osu!" e a marca "ppy" são de ppy Pty Ltd e não são licenciadas por nada',
      'disto. Este é um projeto de fã, sem vínculo com a ppy.',
    ],
  },
];

/**
 * Pacotes de produção do lock, um por `nome@versão`.
 *
 * A chave do lock (`node_modules/a/node_modules/b`) é o caminho real e o nome
 * verdadeiro está depois do último `node_modules/` — duas versões do mesmo
 * pacote convivem, e cada uma tem a sua entrada.
 */
function pacotesDoLock(lock) {
  const porChave = new Map();

  for (const [chave, info] of Object.entries(lock.packages)) {
    if (!chave || info.dev || info.extraneous) continue;

    const nome = chave.slice(chave.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = `${nome}@${info.version}`;
    if (porChave.has(id)) continue;

    porChave.set(id, {
      nome,
      versao:   info.version,
      licenca:  info.license ?? null,
      opcional: Boolean(info.optional),
      // `os`/`cpu` no lock significam binário de plataforma: ele NÃO está
      // instalado aqui se a máquina for outra, e a ausência do texto é
      // esperada em vez de suspeita.
      plataforma: info.os ? `${info.os.join('/')}-${(info.cpu ?? []).join('/')}` : null,
      dir:      path.join(RAIZ, chave),
    });
  }

  return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome) || a.versao.localeCompare(b.versao));
}

/** Textos de licença que o pacote publica, se ele estiver instalado. */
function textosDe(pacote) {
  let arquivos;
  try {
    arquivos = fs.readdirSync(pacote.dir).filter(f => ARQUIVO_LICENCA.test(f)).sort();
  } catch {
    return [];   // não instalado nesta plataforma
  }

  return arquivos
    .map(f => fs.readFileSync(path.join(pacote.dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .filter(Boolean);
}

/**
 * Agrupa por texto idêntico.
 *
 * Os oito pacotes do discord.js publicam a MESMA Apache-2.0, palavra por
 * palavra — repetir as 200 linhas dela oito vezes não cumpre nada a mais e
 * enterra o resto do arquivo. Já duas MIT diferem na linha de copyright, que é
 * justamente o que a licença manda preservar, então essas não se fundem.
 */
function agrupar(pacotes) {
  const grupos = new Map();

  for (const pacote of pacotes) {
    for (const texto of pacote.textos) {
      if (!grupos.has(texto)) grupos.set(texto, { texto, pacotes: [] });
      grupos.get(texto).pacotes.push(pacote);
    }
  }

  return [...grupos.values()].sort((a, b) => {
    const [x, y] = [a.pacotes[0], b.pacotes[0]];
    return (x.licenca ?? '').localeCompare(y.licenca ?? '') || x.nome.localeCompare(y.nome);
  });
}

function gerar() {
  const lock = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package-lock.json'), 'utf8'));
  const pacotes = pacotesDoLock(lock).map(p => ({ ...p, textos: textosDe(p) }));

  const semTexto = pacotes.filter(p => p.textos.length === 0);
  const grupos = agrupar(pacotes.filter(p => p.textos.length > 0));

  const porLicenca = new Map();
  for (const p of pacotes) porLicenca.set(p.licenca, (porLicenca.get(p.licenca) ?? 0) + 1);

  const out = [];
  const w = (...linhas) => out.push(...linhas);

  w('# Avisos de terceiros — KurataniBot',
    '',
    '<!-- GERADO por `npm run notices` a partir do package-lock.json. Não edite à mão: -->',
    '<!-- a próxima geração desfaz. Para mudar o formato, mexa em src/gerar-notices.js. -->',
    '',
    'O KurataniBot é MIT (veja [LICENSE](LICENSE)), mas ele não roda sozinho: o que',
    'está abaixo é de outras pessoas, e MIT, BSD e Apache pedem que o aviso de',
    'copyright e o texto da licença viajem junto com o software. Este arquivo é esse',
    'cumprimento.',
    '',
    `Cobre as **${pacotes.length} dependências de produção** do lock — as transitivas`,
    'inclusive, que são a maioria — e mais duas que o npm não enxerga: a lib Python do',
    'PP do Relax e os ícones de grade, que vieram do jogo. Estas últimas estão em',
    '[O que não vem do npm](#o-que-não-vem-do-npm), no fim.',
    '');

  w('## O que há aqui', '', '| Licença | Pacotes |', '| --- | --- |');
  for (const [licenca, n] of [...porLicenca].sort((a, b) => b[1] - a[1])) {
    w(`| ${licenca ?? '(não declarada)'} | ${n} |`);
  }
  w('');

  w('## A única que não é permissiva', '',
    'O **`@tosuapp/lazer-calculator`** é **LGPL-3.0-only**, e todo o resto é',
    'permissivo (MIT/BSD/Apache/0BSD). A diferença importa: a LGPL alcança quem',
    'redistribui o binário dela, e pede que quem receba possa **trocar a biblioteca**',
    'por outra versão.',
    '',
    'O desenho do bot já satisfaz isso sem esforço, e não por acaso: ele carrega o',
    'calculador como binário separado, num processo filho ([`lazerWorker.js`](src/lazerWorker.js)),',
    'e o pacote vem do npm em vez de compilado junto. Quem clona o repositório troca a',
    'versão mexendo no `package.json` — o código do bot não é obra derivada dele, e o',
    'próprio `npm install` pula o pacote em plataforma sem binário, com o bot',
    'continuando de pé.',
    '');

  w('## Pacotes', '', '| Pacote | Versão | Licença |', '| --- | --- | --- |');
  for (const p of pacotes) {
    const marca = p.plataforma ? ` <sup>${p.plataforma}</sup>` : '';
    w(`| \`${p.nome}\`${marca} | ${p.versao} | ${p.licenca ?? '(não declarada)'} |`);
  }
  w('',
    'O que está marcado com plataforma só instala onde o `os`/`cpu` bate. O binário do',
    'calculador tem uma variante por sistema, e as duas aparecem aqui porque o bot roda',
    'em Windows (desenvolvimento) e Linux (VPS) — a lista sai do lock justamente para',
    'não depender de qual das duas a máquina que gerou o arquivo baixou.',
    '');

  w('## Textos das licenças', '');
  for (const grupo of grupos) {
    const nomes = grupo.pacotes.map(p => `\`${p.nome}\` ${p.versao}`).join(', ');
    w(`### ${grupo.pacotes[0].licenca ?? 'Licença declarada ausente'} — ${nomes}`, '', '```text', grupo.texto, '```', '');
  }

  if (semTexto.length > 0) {
    w('## Pacotes que não publicam o texto da licença', '',
      'Estes declaram a licença no `package.json` mas não incluem um arquivo dela no',
      'pacote publicado — ou são o binário da outra plataforma, que esta máquina não',
      'instalou e de onde não dá para ler nada. O identificador abaixo é o que o pacote',
      'declara; o texto completo está no repositório de cada um. Quando um irmão do',
      'mesmo conjunto publica o texto, ele está na seção acima — é o caso do binário do',
      'calculador, cuja LGPL-3.0 acompanha as outras duas variantes.',
      '',
      '| Pacote | Versão | Licença declarada |', '| --- | --- | --- |');
    for (const p of semTexto) {
      w(`| \`${p.nome}\` | ${p.versao} | ${p.licenca ?? '(não declarada)'} |`);
    }
    w('');
  }

  w('## O que não vem do npm', '',
    'O lock só conhece o que o `npm install` baixa, e o bot usa duas coisas de terceiro',
    'fora disso. Elas entram aqui à mão, pela mesma razão que o resto do arquivo existe.',
    '');

  for (const item of FORA_DO_NPM) {
    w(`### ${item.titulo}`, '', ...item.corpo, '');
    if (item.texto) w('```text', item.texto, '```', '');
  }

  w('Ficam de fora, essas sim: as **dependências de desenvolvimento** (`eslint` e o que',
    'ela puxa), que não sobem para a VPS nem entram em execução do bot.',
    '');

  fs.writeFileSync(SAIDA, out.join('\n'), 'utf8');
  console.log(`THIRD-PARTY-NOTICES.md: ${pacotes.length} pacotes, ${grupos.length} textos, ${semTexto.length} sem texto.`);
}

gerar();

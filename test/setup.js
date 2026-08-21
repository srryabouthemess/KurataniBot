/**
 * test/setup.js
 * Cada processo de teste ganha a sua própria pasta de dados.
 *
 * Carregado por `--require` no script `test` do package.json, o que faz ele
 * rodar ANTES de qualquer módulo do bot — inclusive antes do `src/paths.js`,
 * que lê o `KURATANI_DATA_DIR` uma vez só, no require do topo.
 *
 * O motivo: `node --test test/*.test.js` roda os arquivos em processos
 * PARALELOS, e os que não usam o `dbWorkspace`/`freshDb` dos helpers acabavam
 * abrindo o `bot.db` da raiz do projeto. Dois processos escrevendo no mesmo
 * SQLite dão `SQLITE_BUSY` — que aparecia como um `database is locked`
 * intermitente, sem relação nenhuma com o que o teste estava afirmando.
 *
 * Isolar arquivo por arquivo resolveria os de hoje e não os de amanhã: quem
 * escrevesse um teste novo que carrega um comando (e comando carrega o db)
 * traria a intermitência de volta, sem aviso. Aqui o isolamento é o padrão, e
 * esquecer não é uma opção que exista.
 *
 * De quebra, para de gravar no `bot.db` de desenvolvimento de quem roda a
 * suíte: antes disso, `npm test` mexia nos links e nas preferências reais da
 * máquina.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

/**
 * A pasta-mãe da RODADA, e o marcador de que o `KURATANI_DATA_DIR` que estiver
 * no ambiente foi posto aqui.
 *
 * As duas coisas na mesma variável porque são a mesma pergunta. O runner
 * repassa o ambiente inteiro aos processos filhos, então o `KURATANI_DATA_DIR`
 * definido no processo pai chega já preenchido em todos eles; sem um marcador,
 * cada filho concluiria "veio de fora, respeita" e os arquivos voltariam a
 * dividir um banco só — que é exatamente o que isto existe para evitar.
 */
const RAIZ_ENV = 'KURATANI_TEST_DATA_ROOT';

/**
 * Um `KURATANI_DATA_DIR` de fora manda — é o jeito de apontar a suíte para uma
 * pasta conhecida e ir olhar o banco depois que ela termina. Nesse caso os
 * processos voltam a dividir o mesmo arquivo, então serve para depuração
 * pontual, não para o uso do dia a dia.
 */
const veioDeFora = process.env.KURATANI_DATA_DIR && !process.env[RAIZ_ENV];

if (!veioDeFora) {
  // Quem chega sem a pasta-mãe definida é o processo que abriu a rodada: cria
  // ela e fica responsável por apagá-la INTEIRA no fim.
  //
  // Isso é o que dá conta dos processos que morrem por sinal em vez de sair
  // sozinhos — o `lazerWorker` faz `fork` de um filho Node, que herda este
  // preload e é encerrado com `kill()`. Nesses o `exit` nunca roda, e a pasta
  // ficaria para trás a cada `npm test`. Como todas penduram na mesma mãe,
  // apagar a mãe apaga também as órfãs.
  const abriuARodada = !process.env[RAIZ_ENV];
  const mae = abriuARodada
    ? (process.env[RAIZ_ENV] = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-')))
    : process.env[RAIZ_ENV];

  const dir = path.join(mae, String(process.pid));
  fs.mkdirSync(dir, { recursive: true });
  process.env.KURATANI_DATA_DIR = dir;

  process.on('exit', () => {
    // O handle é fechado antes de apagar: no Windows um SQLite ainda aberto
    // trava o arquivo e o rmSync falha com EPERM. Só fecha o que JÁ foi
    // carregado — pedir o `db` aqui abriria uma conexão nova num processo que
    // nunca chegou a tocar no banco.
    try {
      const conexao = require.resolve('../src/db/connection');
      if (require.cache[conexao]) require.cache[conexao].exports.close();
    } catch { /* nunca carregou, ou já fechado */ }

    try {
      fs.rmSync(abriuARodada ? mae : dir, { recursive: true, force: true });
    } catch { /* pasta temporária presa; o SO limpa depois */ }
  });
}

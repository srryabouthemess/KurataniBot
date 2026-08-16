/**
 * Roteiro do teste "o segfault do runtime .NET não sai do processo-filho".
 *
 * Imita a sequência do shutdown do bot (index.js): usa o worker de PP, fecha, e
 * SÓ ENTÃO faz o trabalho que vem depois — no bot, o `db.close()`. Se o segfault
 * do runtime .NET escapasse do filho, este processo morreria em `close()` e a
 * linha "SOBREVIVEU" nunca sairia.
 *
 * Roda em processo próprio porque é sobre a saída DELE: dentro do runner de
 * testes, um crash aqui contaminaria os outros arquivos.
 */
const path = require('path');
const lazerWorker = require(path.join(__dirname, '..', '..', 'src', 'lazerWorker'));
const { mapaSintetico } = require(path.join(__dirname, '..', 'helpers'));

const MAPA = mapaSintetico(120);

(async () => {
  const attrs = await lazerWorker.calcular(
    'difficulty', 7001, { mods: ['DT'] }, () => Promise.resolve(MAPA),
  );

  if (!attrs || !(attrs.stars > 0)) {
    console.log('FALHOU: o cálculo não voltou', JSON.stringify(attrs));
    process.exit(2);
  }

  lazerWorker.close();

  // O equivalente ao `db.close()` do shutdown: o passo que a versão em worker
  // thread não alcançava, porque o segfault chegava primeiro.
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log('SOBREVIVEU ao close do worker');
  process.exit(0);
})();

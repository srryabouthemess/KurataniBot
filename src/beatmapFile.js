/**
 * beatmapFile.js
 * Os bytes do arquivo `.osu`, do cache em disco quando possível.
 *
 * Saiu do pp.js porque não é cálculo de nada: é download com rate limiter,
 * retry, deduplicação de pedidos em voo e cache. O que o pp faz com esses bytes
 * é outro assunto — e hoje quem os consome já são dois motores em dois lugares
 * distintos (a thread do rosu e o processo do Python).
 *
 * O arquivo é público em `https://osu.ppy.sh/osu/{id}` mesmo para mapa
 * exclusivo de servidor privado, então o endereço é sempre o do osu! oficial —
 * ou o de um dos espelhos, quando ele não responde (ver HOSTS).
 */

require('dotenv').config({ quiet: true });
const axios = require('axios');

const db = require('./db');
const metrics = require('./metrics');
const rateLimiter = require('./rateLimiter');
const { dedupe } = require('./inflight');
const { idSegment } = require('./urlSafe');
const { withRetry } = require('./retry');

// 16MB. O maior `.osu` do cache real tem alguns poucos MB (mapa de maratona com
// dezenas de milhares de objetos), então o teto é generoso o bastante para nunca
// ser sentido em uso normal — ele existe para o caso anormal.
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Quem está pedindo.
 *
 * Os espelhos são serviços da comunidade, mantidos por gente que paga a banda do
 * próprio bolso. Identificar-se é o mínimo de educação, e é o que dá a eles como
 * falar com a gente antes de bloquear, caso o bot algum dia pese.
 */
const USER_AGENT = 'KurataniBot (+https://github.com/srryabouthemess/KurataniBot)';

/**
 * Os hosts que servem o `.osu`, na ordem em que são tentados.
 *
 * ── Por que mais de um ────────────────────────────────────────────────────────
 * Antes havia só o osu!. Quando ele não respondia — ou respondia corpo vazio,
 * que acontece —, o retry insistia CINCO vezes no mesmo endereço e o comando
 * saía sem pp: repetir o pedido para uma máquina que está fora não a traz de
 * volta. O que resolve é perguntar a outra.
 *
 * ── Por que dá para confiar nos espelhos ──────────────────────────────────────
 * Eles servem o mesmo arquivo, e isso foi MEDIDO antes de entrar: sha256 dos
 * três hosts para os mapas 75, 129891 e 4013653 (um de 2007, um grande, um
 * recente) — **byte a byte idênticos** nos três casos.
 *
 * É a única coisa que realmente importa aqui. Um arquivo diferente daria estrela
 * e pp diferentes do oficial, e o erro seria silencioso: nada quebra, os números
 * é que passam a mentir. Se algum dia um espelho for trocado ou acrescentado,
 * refazer essa conferência é parte do trabalho.
 *
 * ── A ordem não é gosto ───────────────────────────────────────────────────────
 * O osu! é a fonte; os espelhos existem para o dia em que ela não responde.
 * Enquanto ela responder, nada muda de lugar e o caminho normal é o de sempre.
 *
 * Cada host tem BALDE PRÓPRIO no rate limiter: são máquinas diferentes, e a fila
 * de uma não tem por que segurar a da outra (mesmo raciocínio do `server:` dos
 * servidores privados, em rateLimiter.js).
 */
const HOSTS = [
  {
    nome:   'osu',
    bucket: 'osuMapFile',
    url:    id => `https://osu.ppy.sh/osu/${idSegment(id)}`,
  },
  {
    nome:   'catboy',
    bucket: 'mapFileCatboy',
    url:    id => `https://catboy.best/osu/${idSegment(id)}`,
  },
  {
    nome:   'osuDirect',
    bucket: 'mapFileOsuDirect',
    url:    id => `https://osu.direct/api/osu/${idSegment(id)}/raw`,
  },
];

/**
 * Tentativas em cada host antes de passar para o próximo.
 *
 * Duas: a primeira pega o blip (timeout solto, socket fechado), e da terceira em
 * diante já é insistência com uma máquina que provavelmente está fora — que é
 * exatamente o que o fallback veio substituir.
 *
 * O orçamento total quase não muda: eram 5 tentativas num host só, agora são 6
 * espalhadas por três. O que muda é onde elas são gastas.
 */
const TENTATIVAS_POR_HOST = 2;

/** O que dizer de uma falha num log: o status HTTP, ou o código de rede, ou a mensagem. */
function descreveErro(error) {
  const status = error?.response?.status;
  if (status) return `HTTP ${status}`;
  return error?.code ?? error?.message ?? 'erro desconhecido';
}

/**
 * Os bytes do mapa naquele host, com retry para erro passageiro.
 * @returns {Promise<Uint8Array>}
 * @throws se as tentativas naquele host acabarem
 */
function baixarDe(host, mapId) {
  return withRetry(async () => {
    await rateLimiter.acquire(host.bucket);

    const res = await axios.get(host.url(mapId), {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
      // Teto de tamanho, e não só de tempo: um corpo enorme entraria inteiro
      // na memória e depois no cache.db, e o teto do cache conta ARQUIVOS, não
      // bytes. O .osu de maratona não passa de ~2MB, então isto exige um host
      // respondendo o que não devia — e agora são três hosts, sendo dois de
      // fora do osu!, o que é mais razão para o teto existir, não menos.
      maxContentLength: MAX_FILE_BYTES,
      maxBodyLength:    MAX_FILE_BYTES,
    });

    const arr = new Uint8Array(res.data);
    if (arr.length === 0) {
      // Acontece logo após reupload de mapa; costuma resolver na retentativa.
      //
      // E, medido, é TAMBÉM o que o osu! responde para mapa que não existe: 200
      // com corpo vazio e `content-type: text/html` (id 2087304), enquanto os
      // dois espelhos respondem 404. Nesse caso nenhuma retentativa vai fazer o
      // arquivo aparecer — e é onde o fallback paga por si duas vezes: o que
      // eram cinco esperas até desistir vira duas, e o erro que chega em quem
      // chamou passa a ser o 404 do espelho, que ao menos diz o que houve.
      const err = new Error(`arquivo .osu vazio para o mapa ${mapId} (${host.nome})`);
      err.retryable = true;
      throw err;
    }
    return arr;
  }, { attempts: TENTATIVAS_POR_HOST, baseMs: 500 });
}

/**
 * @returns {Promise<Uint8Array>}
 * @throws se o download falhar em todos os hosts
 */
async function getBeatmapFile(mapId) {
  const cached = db.getBeatmapFile(mapId);
  if (cached) return new Uint8Array(cached);

  // O dedupe compartilha o download com quem pedir o mesmo mapa enquanto ele
  // está em voo: numa página, duas plays do mesmo mapa baixavam duas vezes,
  // porque o cache só ajuda depois que a primeira termina (ver inflight.js).
  return dedupe(`file:${mapId}`, async () => {
    const falhas = [];

    for (const host of HOSTS) {
      try {
        const bytes = await baixarDe(host, mapId);

        metrics.count(`mapFile.${host.nome}.ok`);
        // O número que diz se o fallback está ganhando o lugar dele: quantas
        // vezes um espelho entregou o que o host anterior não entregou. Se ele
        // ficar em zero por muito tempo, isto aqui é peso morto; se subir, é
        // porque tem havido play calculada que antes teria saído sem pp.
        if (falhas.length > 0) metrics.count('mapFile.espelhoSalvou');

        db.setBeatmapFile(mapId, bytes);
        return bytes;
      } catch (error) {
        metrics.count(`mapFile.${host.nome}.falhou`);
        falhas.push({ host: host.nome, error });
      }
    }

    // A mensagem leva os três motivos porque é ela que vai para o log: saber que
    // o osu! deu 503 e os espelhos deram 404 é um diagnóstico (mapa não existe),
    // e três timeouts são outro (a rede daqui). A `cause` fica com a falha do
    // osu! por ser a da fonte — é a pilha que costuma explicar o resto.
    const resumo = falhas.map(f => `${f.host}: ${descreveErro(f.error)}`).join('; ');
    throw new Error(
      `falha ao baixar o .osu do mapa ${mapId} — ${resumo}`,
      { cause: falhas[0]?.error },
    );
  });
}

module.exports = { getBeatmapFile, HOSTS };

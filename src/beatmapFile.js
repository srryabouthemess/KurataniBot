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
 * exclusivo de servidor privado, então o endereço é sempre o oficial.
 */

require('dotenv').config({ quiet: true });
const axios = require('axios');

const db = require('./db');
const rateLimiter = require('./rateLimiter');
const { dedupe } = require('./inflight');
const { idSegment } = require('./urlSafe');
const { withRetry } = require('./retry');

/**
 * @returns {Promise<Uint8Array>}
 * @throws se o download falhar em todas as tentativas
 */
async function getBeatmapFile(mapId) {
  const cached = db.getBeatmapFile(mapId);
  if (cached) return new Uint8Array(cached);

  // O dedupe compartilha o download com quem pedir o mesmo mapa enquanto ele
  // está em voo: numa página, duas plays do mesmo mapa baixavam duas vezes,
  // porque o cache só ajuda depois que a primeira termina (ver inflight.js).
  return dedupe(`file:${mapId}`, async () => {
    const bytes = await withRetry(async () => {
      await rateLimiter.acquire('osuMapFile');
      const res = await axios.get(`https://osu.ppy.sh/osu/${idSegment(mapId)}`, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      const arr = new Uint8Array(res.data);
      if (arr.length === 0) {
        // Acontece logo após reupload de mapa; costuma resolver na retentativa.
        const err = new Error(`arquivo .osu vazio para o mapa ${mapId}`);
        err.retryable = true;
        throw err;
      }
      return arr;
    }, { attempts: 5, baseMs: 500, maxMs: 10000 });

    db.setBeatmapFile(mapId, bytes);
    return bytes;
  });
}

module.exports = { getBeatmapFile };

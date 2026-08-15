/**
 * prefix/config.js
 * A configuração do modo texto, num lugar só.
 *
 * Existe porque três peças precisam dela e nenhuma delas deveria ler o
 * ambiente por conta própria: o dispatcher (para saber se liga), o `spec`
 * (para montar a linha de uso, que começa com o prefixo) e o index.js (para os
 * intents).
 */

require('dotenv').config({ quiet: true });

const PREFIX = (process.env.COMMAND_PREFIX ?? '').trim();

/**
 * Sem prefixo configurado, o modo texto não existe: nem o listener é
 * registrado, nem o intent privilegiado é pedido ao Discord.
 */
const ENABLED = PREFIX.length > 0;

module.exports = { PREFIX, ENABLED };

/**
 * urlSafe.js
 * Escapa valores antes de interpolá-los num caminho de URL.
 *
 * Sem isso, um nome de jogador como `../../../wiki/pt` fazia a requisição
 * escapar do prefixo /api/v2 e ir para outro caminho de osu.ppy.sh — levando
 * junto o header Authorization. O host é fixo, então o token não vazava para
 * terceiros, mas o usuário conseguia fazer o bot emitir requisições
 * autenticadas para endpoints arbitrários da API.
 *
 * Fica num módulo próprio porque tanto o cliente de API quanto o download de
 * `.osu` (pp.js) montam caminho com dado que veio de fora.
 */

function urlSegment(value) {
  return encodeURIComponent(String(value));
}

/**
 * Escapa um identificador que deveria ser numérico. Lança se não for — um ID
 * não-numérico aqui significa que algo já corrompeu o fluxo antes.
 */
function idSegment(value) {
  const str = String(value);
  if (!/^\d+$/.test(str)) throw new Error(`identificador inválido em caminho de URL: ${str}`);
  return str;
}

module.exports = { urlSegment, idSegment };

/**
 * prefix/tokenize.js
 * Quebra a linha digitada em tokens, respeitando aspas.
 *
 * As aspas existem porque nick de osu! pode ter espaço: sem elas não há como
 * distinguir `k!rs Some Guy` (um nick) de dois argumentos posicionais.
 *
 * Sem dependência nenhuma — é texto entrando e texto saindo, o que deixa esta
 * peça testável sem nada do Discord por perto.
 */

// Aspas retas e as "inteligentes" que o teclado do Discord mobile insere.
const QUOTES = new Set(['"', '\u201C', '\u201D']);

/**
 * Aspas de abertura e fechamento diferentes ainda precisam casar: o teclado do
 * Discord mobile troca `"` por `“ ”` sozinho, e quem digitou não percebe.
 */
function closesQuote(open, char) {
  if (open === '"') return char === '"';
  return char === '“' || char === '”';
}

// ─── Leitura da linha de comando ──────────────────────────────────────────────

/**
 * Quebra a mensagem em tokens, respeitando aspas.
 *
 * As aspas existem porque nick de osu! pode ter espaço: sem elas não há como
 * distinguir `k!rs Some Guy` (um nick) de dois argumentos posicionais.
 */
function tokenize(input) {
  const tokens = [];
  let current  = '';
  let started  = false;
  let quote    = null;

  const push = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };

  for (const char of input) {
    if (quote) {
      if (closesQuote(quote, char)) quote = null;
      else current += char;
      continue;
    }
    if (QUOTES.has(char)) {
      quote   = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    current += char;
    started  = true;
  }
  push();

  return tokens;
}

module.exports = { tokenize };

/**
 * commands/admin/scorewipe/limits.js
 * Tetos e janelas do /scorewipe, num lugar que as duas telas (a de um score e
 * a do lote) enxergam sem uma importar a outra.
 */

const REASON_MAX_LENGTH = 200;

// Janelas curtas, pelo mesmo motivo do /wipe: um botão de destruição pendurado
// numa mensagem antiga é um acidente esperando alguém passar por perto.
const PICK_MS    = 60_000;
const CONFIRM_MS = 60_000;

/** Quantas plays a lista oferece. */
const CANDIDATOS = 10;

/**
 * Teto da lista de plays dentro da descrição do embed.
 *
 * O limite do Discord é 4096; o resto da folga fica para o cabeçalho e os dois
 * avisos que vêm depois da lista.
 */
const LISTA_MAX_CHARS = 2500;

module.exports = {
  REASON_MAX_LENGTH,
  PICK_MS,
  CONFIRM_MS,
  CANDIDATOS,
  LISTA_MAX_CHARS,
};

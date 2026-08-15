/**
 * markdown.js
 * Neutraliza texto que veio de FORA antes de ele entrar num embed.
 *
 * ── O problema ────────────────────────────────────────────────────────────────
 * Nome de mapa, de mapper e de jogador são escolhidos por quem os criou, e o bot
 * os interpola direto em posição de markdown. Um título com `](url)` fecha o
 * link do bot e abre outro:
 *
 *   título:    Musica](https://sitefalso.example) [clique aqui
 *   resultado: [MC - Musica](https://sitefalso.example) [clique aqui [Normal]](...)
 *
 * O Discord renderiza isso como link de verdade, com o texto que o atacante
 * escolheu, dentro de um embed do bot — que é justamente o que dá credibilidade
 * ao golpe. Custa nada explorar: mapa graveyard não passa por moderação, e
 * `/score <id>` exibe o título de qualquer mapa sem nem precisar jogá-lo.
 *
 * ── Onde aplicar, e onde NÃO ──────────────────────────────────────────────────
 * Só **descrição** e **content** renderizam markdown. `setTitle`, `setAuthor` e
 * `setFooter` são texto puro: escapar ali não protege de nada e ainda imprime as
 * contrabarras na tela. É por isso que o título do /recent nunca esteve exposto,
 * e é o motivo de esta função não morar dentro do `mapTitle()` — o mesmo texto
 * vai para os dois lugares.
 *
 * ── O que a contrabarra alcança ───────────────────────────────────────────────
 * O Discord só trata `\` como escape diante de um caractere que tem significado;
 * antes de qualquer outro, a contrabarra aparece na tela. Por isso a lista abaixo
 * é exatamente o conjunto escapável, e não "todo símbolo por precaução".
 *
 * Construções de início de linha (`# `, `- `, `> `) não entram na lista: elas só
 * valem no começo de uma linha, e o texto externo é interpolado no meio de uma —
 * a menos que ele traga a própria quebra de linha, que é o que a limpeza de
 * controle abaixo remove. É a mesma decisão do `signReason` no daycoreAdmin.
 *
 * ── O que fica de fora, e por quê ─────────────────────────────────────────────
 * URL solta continua virando link clicável, e não há contrabarra que impeça. Não
 * é o mesmo risco: o que este módulo fecha é **forjar o rótulo** — fazer um link
 * dizer "clique aqui" e levar a outro lugar. Uma URL visível mostra para onde
 * vai, e quem lê decide. Fechar isso exigiria mutilar o texto (zero-width no
 * meio do `://`), o que estragaria título legítimo por um ganho pequeno.
 */

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001F\u007F]+/g;

/** Exatamente os caracteres que o Discord aceita escapar com `\`. */
const ESCAPAVEIS = /([\\`*_~|[\]()])/g;

/**
 * Texto externo pronto para entrar numa descrição de embed.
 *
 * @param {*} texto qualquer coisa; `null`/`undefined` viram string vazia
 * @returns {string}
 */
function md(texto) {
  return String(texto ?? '')
    // Quebra de linha vira espaço ANTES do escape: sem isso um título com `\n`
    // ainda conseguiria abrir cabeçalho ou citação na linha que ele cria.
    .replace(CONTROLE, ' ')
    .replace(ESCAPAVEIS, '\\$1');
}

module.exports = { md };

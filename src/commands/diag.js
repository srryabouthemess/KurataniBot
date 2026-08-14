const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const metrics = require('../metrics');
// Direto nos workers, e não via pp.js: o que interessa aqui é o estado dos
// motores, não o cálculo. Pelo pp o comando arrastaria junto o banco e todo o
// caminho de PP para montar um embed de contadores.
const pythonWorker = require('../pythonWorker');
const rosuWorker = require('../rosuWorker');
const { t } = require('../i18n');

/**
 * Diagnóstico do próprio bot.
 *
 * Todo ajuste de desempenho até aqui foi medido com script de bancada, o que
 * serve para DECIDIR uma mudança e não serve para nada depois dela: em produção
 * não havia como saber se o cache está acertando, se algum balde do rate limiter
 * virou fila, ou se a thread do rosu está mesmo de pé.
 *
 * Os números são do processo, e zeram no restart — é diagnóstico do "agora", não
 * histórico.
 */

/** `93784000` → `1d 2h 3m`. Sem segundos: a escala aqui é de horas e dias. */
function duracao(ms) {
  const total = Math.floor(ms / 1000);
  const partes = [
    [Math.floor(total / 86400), 'd'],
    [Math.floor(total / 3600) % 24, 'h'],
    [Math.floor(total / 60) % 60, 'm'],
  ].filter(([valor]) => valor > 0);

  return partes.length ? partes.map(([valor, letra]) => `${valor}${letra}`).join(' ') : '<1m';
}

const porcento = (taxa) => (taxa === null ? '—' : `${(taxa * 100).toFixed(0)}%`);

function linhasDeCache(caches) {
  return Object.entries(caches)
    .map(([nome, d]) => `\`${nome.padEnd(14)}\` ${porcento(d.taxa).padStart(4)} — ${d.hit}/${d.total}`);
}

/**
 * Junta `limiter.<balde>.calls` e `limiter.<balde>.waitMs` numa linha por balde.
 *
 * A espera acumulada é o número que diz se um balde está apertado demais: sem
 * ela, "o bot está lento" não distingue API lenta de limite nosso mal calibrado.
 */
function linhasDeLimiter(contadores) {
  const baldes = {};

  for (const [chave, valor] of Object.entries(contadores)) {
    const m = chave.match(/^limiter\.(.+)\.(calls|waitMs)$/);
    if (!m) continue;
    const [, nome, campo] = m;
    baldes[nome] ??= { calls: 0, waitMs: 0 };
    baldes[nome][campo] = valor;
  }

  return Object.entries(baldes).map(([nome, d]) =>
    `\`${nome.padEnd(14)}\` ${String(d.calls).padStart(5)} — ${(d.waitMs / 1000).toFixed(1)}s`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('diag')
    .setDescription('Bot diagnostics (server administrators)')
    .setDescriptionLocalizations({ 'pt-BR': 'Diagnóstico do bot (administradores do servidor)' })
    // "0" no Discord quer dizer "ninguém, exceto quem administra o servidor".
    // Não é dado sensível — são contadores do processo —, mas também não é
    // resposta que interesse a quem só quer ver as próprias plays.
    .setDefaultMemberPermissions(0)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]),

  // Responde em efêmero, e efêmero só existe dentro de interação: no modo texto
  // a flag some e a resposta viraria mensagem no canal (ver prefix/spec.js).
  prefix: { slashOnly: true },

  async execute(interaction) {
    const s = t(interaction);
    const { uptimeMs, contadores, caches } = metrics.snapshot();
    const workers = { rosu: rosuWorker.stats(), python: pythonWorker.stats() };

    const embed = new EmbedBuilder()
      .setColor(0x99ccff)
      .setTitle(s.diag_title)
      .setDescription(s.diag_uptime(duracao(uptimeMs)));

    const cacheLinhas = linhasDeCache(caches);
    const limiterLinhas = linhasDeLimiter(contadores);

    if (cacheLinhas.length === 0 && limiterLinhas.length === 0) {
      embed.addFields({ name: '​', value: s.diag_empty });
    }

    if (cacheLinhas.length > 0) {
      embed.addFields({ name: s.diag_caches, value: cacheLinhas.join('\n') });
    }
    if (limiterLinhas.length > 0) {
      embed.addFields({ name: s.diag_limiter, value: limiterLinhas.join('\n') });
    }

    embed.addFields({
      name: s.diag_workers,
      value: [
        s.diag_worker_line('rosu-pp', workers.rosu.vivo, workers.rosu.served, workers.rosu.failed),
        s.diag_worker_line('akatsuki-pp', workers.python.vivo, workers.python.served, workers.python.failed),
      ].join('\n'),
    });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

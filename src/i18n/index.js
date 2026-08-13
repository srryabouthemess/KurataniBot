/**
 * i18n/index.js
 * Internacionalização do KurataniBot.
 *
 * Um arquivo por idioma: antes eram os três num objeto só de 600 linhas, e
 * acrescentar uma chave significava editar três blocos distantes um do outro.
 *
 * Prioridade de resolução: usuário > servidor > 'pt' (padrão).
 */

const db = require('../db');
const servers = require('../servers');

// Nome do servidor que os comandos administrativos operam. Antes era "Daycore"
// escrito nos textos, o que ficava errado na cara de quem hospedasse o bot para
// outro servidor — o rótulo agora vem do registro, como no resto do bot.
const ADMIN = servers.label(servers.resolveKey('private') ?? servers.OFFICIAL_KEY);

const translations = {
  pt: require('./pt')({ ADMIN }),
  en: require('./en')({ ADMIN }),
  ru: require('./ru')({ ADMIN }),
};

const SUPPORTED_LANGS = { pt: 'Português', en: 'English', ru: 'Русский' };

/**
 * Strings do idioma ativo para aquela interação.
 * Prioridade: usuário > servidor > 'pt'.
 */
function t(interaction) {
  const userLang   = db.getUserLang(interaction.user.id);
  const serverLang = interaction.guildId ? db.getServerLang(interaction.guildId) : null;
  const lang       = userLang ?? serverLang ?? 'pt';
  return translations[lang] ?? translations.pt;
}

/**
 * Strings do idioma do SERVIDOR, para mensagem que não nasce de interação.
 *
 * O anúncio de mapa rankeado dentro do jogo não tem quem o rodou — não existe
 * usuário cuja preferência consultar, então a escala de prioridade perde o
 * primeiro degrau e começa no idioma do servidor.
 */
function forGuild(guildId) {
  const lang = (guildId ? db.getServerLang(guildId) : null) ?? 'pt';
  return translations[lang] ?? translations.pt;
}

module.exports = { t, forGuild, SUPPORTED_LANGS };

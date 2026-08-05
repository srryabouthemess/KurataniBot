/**
 * i18n.js
 * Sistema de internacionalização do KurataniBot.
 *
 * Idiomas suportados: 'pt' (Português BR), 'en' (English), 'ru' (Русский)
 * Prioridade de resolução: usuário > servidor > 'pt' (default)
 */

const fs   = require('fs');
const path = require('path');

const LANG_PATH = path.join(__dirname, 'languages.json');

// ─── Strings de tradução ──────────────────────────────────────────────────────

const translations = {
  pt: {
    player_not_found:        '❌ Jogador não encontrado.',
    error_generic:           '❌ Ocorreu um erro ao buscar os dados.',
    no_link_set:             '❌ Você não tem um link definido. Use `/link set` ou informe o nome do jogador.',

    profile_title:           (name) => `Perfil de ${name}`,
    profile_ranks:           '🌐 Ranks',
    profile_global:          'Global',
    profile_regional:        (code) => `Regional (${code})`,
    profile_unranked:        'Unranked',
    profile_stats:           '📊 Estatísticas',
    profile_acc:             'Acc',
    profile_max_combo:       'Max Combo',
    profile_status:          '🎮 Status',
    profile_online:          '🟢 Online',
    profile_offline:         (ts) => `🔴 Offline\nÚltima vez: ${ts}`,
    profile_top_play:        '📌 Top Play',
    profile_no_play:         'Nenhuma play encontrada.',
    profile_created_at:      '📅 Conta criada em',
    profile_footer:          (label) => `osu! Stats • ${label}`,

    topplays_none:           'Nenhuma play encontrada.',
    topplays_footer:         (page, total, label) => `Página ${page}/${total} • Modo: osu! • ${label}`,
    topplays_error:          'Erro ao buscar as top plays.',
    pagination_not_yours:    '❌ Apenas quem usou o comando pode navegar entre as páginas.',

    recent_author:           (name) => `Play recente de ${name}`,
    recent_none:             (name) => `Nenhuma play recente encontrada para **${name}**.`,
    recent_status:           'Status',
    recent_rank:             'Rank',
    recent_mods:             'Mods',
    recent_stats:            'Estatísticas',
    recent_pp:               'PP',
    recent_acc:              'Acc',
    recent_combo:            'Combo',
    recent_hits:             'Hits',
    recent_pass:             '✅ **Pass**',
    recent_fail:             '❌ **Quit**',
    recent_error:            'Erro ao buscar a play recente. Verifique se o jogador existe.',
    recent_footer:           (mode, date, label, page, total) => `Play ${page}/${total} • Modo: ${mode} | ${date} • ${label}`,

    compare_title:           'Comparação osu!',
    compare_not_found:       '❌ Um ou ambos os jogadores não foram encontrados.',
    compare_need_user1:      '❌ Informe pelo menos o primeiro jogador, ou use `/link set` para vincular sua conta.',
    compare_need_user2:      '❌ Informe o segundo jogador para comparar.',
    compare_footer:          (user, label) => `Solicitado por ${user} • ${label}`,
    compare_error:           'Erro ao comparar jogadores. Verifique se os nicks estão corretos.',
    compare_header_label:    'osu!',

    link_no_link:            '❌ Você não tem nenhum link definido. Use `/link set` para criar um.',
    link_status_msg:         (user, label) => `🔗 Seu link atual: **${user}** no **${label}**`,
    link_removed:            '✅ Link removido com sucesso.',
    link_nothing_to_remove:  '❌ Você não tinha nenhum link para remover.',
    link_not_found:          '❌ Jogador não encontrado. Verifique o nome e o servidor.',
    link_success_title:      '✅ Link definido!',
    link_success_desc:       (user, label) =>
      `Sua conta Discord foi vinculada a **${user}** no **${label}**.\n\n` +
      `Agora você pode usar \`/recent\`, \`/profile\`, \`/topplays\` e \`/compare\` sem precisar digitar seu nome!`,
    link_error:              '❌ Ocorreu um erro ao verificar o jogador.',

    lang_set:                (lang) => `✅ Idioma definido para **${lang}**.`,
    lang_set_server:         (lang) => `✅ Idioma do servidor definido para **${lang}**.`,
    lang_reset_server:       '✅ Idioma do servidor resetado para o padrão.',
    lang_no_permission:      '❌ Você precisa da permissão de **Administrador** para alterar o idioma do servidor.',
    lang_current_user:       (lang) => `🌐 Seu idioma atual: **${lang}**`,
    lang_current_server:     (lang) => `🌐 Idioma do servidor: **${lang}**`,
    lang_current_none:       '🌐 Nenhum idioma definido (usando padrão: Português).',
  },

  en: {
    player_not_found:        '❌ Player not found.',
    error_generic:           '❌ An error occurred while fetching data.',
    no_link_set:             '❌ You have no link set. Use `/link set` or provide a player name.',

    profile_title:           (name) => `${name}'s Profile`,
    profile_ranks:           '🌐 Ranks',
    profile_global:          'Global',
    profile_regional:        (code) => `Regional (${code})`,
    profile_unranked:        'Unranked',
    profile_stats:           '📊 Statistics',
    profile_acc:             'Acc',
    profile_max_combo:       'Max Combo',
    profile_status:          '🎮 Status',
    profile_online:          '🟢 Online',
    profile_offline:         (ts) => `🔴 Offline\nLast seen: ${ts}`,
    profile_top_play:        '📌 Top Play',
    profile_no_play:         'No plays found.',
    profile_created_at:      '📅 Account Created',
    profile_footer:          (label) => `osu! Stats • ${label}`,

    topplays_none:           'No plays found.',
    topplays_footer:         (page, total, label) => `Page ${page}/${total} • Mode: osu! • ${label}`,
    topplays_error:          'Error fetching top plays.',
    pagination_not_yours:    "❌ Only the person who ran the command can navigate the pages.",

    recent_author:           (name) => `${name}'s recent play`,
    recent_none:             (name) => `No recent plays found for **${name}**.`,
    recent_status:           'Status',
    recent_rank:             'Rank',
    recent_mods:             'Mods',
    recent_stats:            'Statistics',
    recent_pp:               'PP',
    recent_acc:              'Acc',
    recent_combo:            'Combo',
    recent_hits:             'Hits',
    recent_pass:             '✅ **Pass**',
    recent_fail:             '❌ **Quit**',
    recent_error:            'Error fetching recent play. Check if the player exists.',
    recent_footer:           (mode, date, label, page, total) => `Play ${page}/${total} • Mode: ${mode} | ${date} • ${label}`,

    compare_title:           'osu! Comparison',
    compare_not_found:       '❌ One or both players were not found.',
    compare_need_user1:      '❌ Provide at least the first player, or use `/link set` to link your account.',
    compare_need_user2:      '❌ Provide the second player to compare.',
    compare_footer:          (user, label) => `Requested by ${user} • ${label}`,
    compare_error:           'Error comparing players. Check if the usernames are correct.',
    compare_header_label:    'osu!',

    link_no_link:            '❌ You have no link set. Use `/link set` to create one.',
    link_status_msg:         (user, label) => `🔗 Your current link: **${user}** on **${label}**`,
    link_removed:            '✅ Link removed successfully.',
    link_nothing_to_remove:  '❌ You had no link to remove.',
    link_not_found:          '❌ Player not found. Check the name and server.',
    link_success_title:      '✅ Link set!',
    link_success_desc:       (user, label) =>
      `Your Discord account has been linked to **${user}** on **${label}**.\n\n` +
      `You can now use \`/recent\`, \`/profile\`, \`/topplays\` and \`/compare\` without typing your name!`,
    link_error:              '❌ An error occurred while verifying the player.',

    lang_set:                (lang) => `✅ Language set to **${lang}**.`,
    lang_set_server:         (lang) => `✅ Server language set to **${lang}**.`,
    lang_reset_server:       '✅ Server language reset to default.',
    lang_no_permission:      '❌ You need **Administrator** permission to change the server language.',
    lang_current_user:       (lang) => `🌐 Your current language: **${lang}**`,
    lang_current_server:     (lang) => `🌐 Server language: **${lang}**`,
    lang_current_none:       '🌐 No language set (using default: English).',
  },

  ru: {
    player_not_found:        '❌ Игрок не найден.',
    error_generic:           '❌ Произошла ошибка при получении данных.',
    no_link_set:             '❌ У вас не привязан аккаунт. Используйте `/link set` или укажите имя игрока.',

    profile_title:           (name) => `Профиль ${name}`,
    profile_ranks:           '🌐 Ранки',
    profile_global:          'Глобальный',
    profile_regional:        (code) => `Региональный (${code})`,
    profile_unranked:        'Unranked',
    profile_stats:           '📊 Статистика',
    profile_acc:             'Acc',
    profile_max_combo:       'Max Combo',
    profile_status:          '🎮 Статус',
    profile_online:          '🟢 Онлайн',
    profile_offline:         (ts) => `🔴 Оффлайн\nПоследний раз в сети: ${ts}`,
    profile_top_play:        '📌 Топ плей',
    profile_no_play:         'Плей не найден.',
    profile_created_at:      '📅 Аккаунт создан',
    profile_footer:          (label) => `osu! Stats • ${label}`,

    topplays_none:           'Плеев не найдено.',
    topplays_footer:         (page, total, label) => `Страница ${page}/${total} • Режим: osu! • ${label}`,
    topplays_error:          'Ошибка при получении топ плеев.',
    pagination_not_yours:    '❌ Только автор команды может переключать страницы.',

    recent_author:           (name) => `Последний плей ${name}`,
    recent_none:             (name) => `Недавних плеев для **${name}** не найдено.`,
    recent_status:           'Статус',
    recent_rank:             'Ранк',
    recent_mods:             'Моды',
    recent_stats:            'Статистика',
    recent_pp:               'PP',
    recent_acc:              'Acc',
    recent_combo:            'Комбо',
    recent_hits:             'Хиты',
    recent_pass:             '✅ **Pass**',
    recent_fail:             '❌ **Quit**',
    recent_error:            'Ошибка при получении последнего плея. Проверьте, существует ли игрок.',
    recent_footer:           (mode, date, label, page, total) => `Плей ${page}/${total} • Режим: ${mode} | ${date} • ${label}`,

    compare_title:           'Сравнение osu!',
    compare_not_found:       '❌ Один или оба игрока не найдены.',
    compare_need_user1:      '❌ Укажите хотя бы первого игрока, или используйте `/link set`, чтобы привязать аккаунт.',
    compare_need_user2:      '❌ Укажите второго игрока для сравнения.',
    compare_footer:          (user, label) => `Запрошено ${user} • ${label}`,
    compare_error:           'Ошибка при сравнении игроков. Проверьте правильность никнеймов.',
    compare_header_label:    'osu!',

    link_no_link:            '❌ У вас нет привязанного аккаунта. Используйте `/link set`, чтобы создать.',
    link_status_msg:         (user, label) => `🔗 Текущая привязка: **${user}** на **${label}**`,
    link_removed:            '✅ Привязка успешно удалена.',
    link_nothing_to_remove:  '❌ У вас не было привязки для удаления.',
    link_not_found:          '❌ Игрок не найден. Проверьте имя и сервер.',
    link_success_title:      '✅ Привязка установлена!',
    link_success_desc:       (user, label) =>
      `Ваш Discord-аккаунт привязан к **${user}** на **${label}**.\n\n` +
      `Теперь вы можете использовать \`/recent\`, \`/profile\`, \`/topplays\` и \`/compare\` без ввода имени!`,
    link_error:              '❌ Произошла ошибка при проверке игрока.',

    lang_set:                (lang) => `✅ Язык установлен: **${lang}**.`,
    lang_set_server:         (lang) => `✅ Язык сервера установлен: **${lang}**.`,
    lang_reset_server:       '✅ Язык сервера сброшен на стандартный.',
    lang_no_permission:      '❌ Вам нужны права **Администратора**, чтобы изменить язык сервера.',
    lang_current_user:       (lang) => `🌐 Ваш текущий язык: **${lang}**`,
    lang_current_server:     (lang) => `🌐 Язык сервера: **${lang}**`,
    lang_current_none:       '🌐 Язык не установлен (используется стандартный: Русский).',
  },
};

// ─── Persistência ─────────────────────────────────────────────────────────────

function loadLangData() {
  try {
    return JSON.parse(fs.readFileSync(LANG_PATH, 'utf8'));
  } catch {
    return { users: {}, servers: {} };
  }
}

function saveLangData(data) {
  fs.writeFileSync(LANG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function setUserLang(discordId, lang) {
  const data = loadLangData();
  data.users = data.users ?? {};
  data.users[discordId] = lang;
  saveLangData(data);
}

function setServerLang(guildId, lang) {
  const data = loadLangData();
  data.servers = data.servers ?? {};
  if (lang === null) {
    delete data.servers[guildId];
  } else {
    data.servers[guildId] = lang;
  }
  saveLangData(data);
}

// ─── Resolução de idioma ──────────────────────────────────────────────────────

/**
 * Retorna as strings de tradução para a interação.
 * Prioridade: usuário > servidor > 'pt' (default)
 */
function t(interaction) {
  const data       = loadLangData();
  const userLang   = data.users?.[interaction.user.id];
  const serverLang = interaction.guildId ? data.servers?.[interaction.guildId] : undefined;
  const lang       = userLang ?? serverLang ?? 'pt';
  return translations[lang] ?? translations['pt'];
}

const SUPPORTED_LANGS = { pt: 'Português', en: 'English', ru: 'Русский' };

module.exports = { t, setUserLang, setServerLang, loadLangData, SUPPORTED_LANGS };

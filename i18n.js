/**
 * i18n.js
 * Sistema de internacionalização do KurataniBot.
 *
 * Idiomas suportados: 'pt' (Português BR), 'en' (English), 'ru' (Русский)
 * Prioridade de resolução: usuário > servidor > 'pt' (default)
 *
 * A persistência das preferências de idioma vive em db.js (SQLite), junto
 * com as outras preferências do usuário (ex: link osu!) — este arquivo cuida
 * só das strings e da resolução do idioma ativo.
 */

const db = require('./db');

// ─── Strings de tradução ──────────────────────────────────────────────────────

const translations = {
  pt: {
    // Locale para formatação de números (ex: 10.000 vs 10,000)
    locale:                  'pt-BR',

    player_not_found:        '❌ Jogador não encontrado.',
    error_generic:           '❌ Ocorreu um erro ao buscar os dados.',
    no_link_set:             '❌ Você não tem um link definido. Use `/link set` ou informe o nome do jogador.',
    cooldown_wait:           (secs) => `⏳ Calma aí! Tente de novo em **${secs}s**.`,

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
    link_status_header:      '🔗 Seus links:',
    link_status_line:        (label, user, isDefault) =>
      `• **${label}** — ${user}${isDefault ? '  ⭐ *(padrão)*' : ''}`,
    link_status_hint:        'O servidor ⭐ é usado quando você não passa a opção `server`.',
    link_removed:            '✅ Link removido com sucesso.',
    link_removed_server:     (label) => `✅ Link do **${label}** removido.`,
    link_removed_all:        (n) => `✅ ${n} link(s) removido(s).`,
    link_nothing_to_remove:  '❌ Você não tinha nenhum link para remover.',
    link_not_found:          '❌ Jogador não encontrado. Verifique o nome e o servidor.',
    link_success_title:      '✅ Link definido!',
    link_success_desc:       (user, label) =>
      `Sua conta Discord foi vinculada a **${user}** no **${label}**.\n\n` +
      `**${label}** agora é seu servidor padrão — comandos sem a opção \`server\` vão usar ele. ` +
      `Você pode ter um link por servidor e trocar o padrão com \`/link default\`.`,
    link_error:              '❌ Ocorreu um erro ao verificar o jogador.',
    link_default_set:        (label) => `✅ Servidor padrão definido para **${label}**.`,
    link_default_missing:    (label) => `❌ Você não tem link no **${label}**. Use \`/link set\` nesse servidor primeiro.`,
    no_link_for_server:      (label) =>
      `❌ Você não tem link no **${label}**. Use \`/link set\` para vincular sua conta desse servidor, ` +
      `ou informe o nome do jogador no próprio comando.`,

    lang_set:                (lang) => `✅ Idioma definido para **${lang}**.`,
    lang_set_server:         (lang) => `✅ Idioma do servidor definido para **${lang}**.`,
    lang_reset_server:       '✅ Idioma do servidor resetado para o padrão.',
    lang_no_permission:      '❌ Você precisa da permissão de **Administrador** para alterar o idioma do servidor.',
    lang_current_user:       (lang) => `🌐 Seu idioma atual: **${lang}**`,
    lang_current_server:     (lang) => `🌐 Idioma do servidor: **${lang}**`,
    lang_current_none:       '🌐 Nenhum idioma definido (usando padrão: Português).',

    simulate_invalid_map:    '❌ Não consegui identificar o mapa. Use o ID do beatmap ou um link (ex: `https://osu.ppy.sh/beatmapsets/123#osu/456`).',
    simulate_map_not_found:  '❌ Mapa não encontrado.',
    simulate_calc_error:     '❌ Não consegui calcular o PP para essa simulação. Verifique se os valores fazem sentido para o mapa.',
    simulate_error:          '❌ Ocorreu um erro ao simular a play.',
    simulate_mods_none:      'Nenhum',
    simulate_title:          'Simulação de PP',
    simulate_combo_fc:       'Full Combo',
    simulate_combo_assumed:  'combo máximo assumido',
    simulate_footer:         (label) => `Simulação • ${label}`,

    // Compartilhado entre /pp e /whatif
    no_plays:                (name, label) => `**${name}** não tem plays em ${label}.`,
    footer_based_on:         (label, count) => `${label} • baseado nas top ${count} plays`,

    pp_already:              (name, current, target) =>
      `**${name}** já tem **${current}pp**, o que é maior ou igual a **${target}pp**! 🎉`,
    pp_title:                (name, target) => `Qual score falta para ${name} alcançar ${target}pp?`,
    pp_desc_best:            (name, target, required) =>
      `Para chegar aos **${target}pp** com um único score, **${name}** precisaria fazer uma play de ` +
      `**${required}pp**, que seria sua nova **#1** melhor jogada! 🎉`,
    pp_desc_position:        (name, target, required, position) =>
      `Para chegar aos **${target}pp** com um único score, **${name}** precisaria fazer uma play de ` +
      `**${required}pp**, que seria sua **#${position}ª** melhor jogada.`,

    whatif_title:            (name, pp) => `E se ${name} fizesse uma play de ${pp}pp?`,
    whatif_pos_best:         (name, pp) =>
      `Uma play de **${pp}pp** seria a nova **#1** melhor jogada de **${name}**! 🎉`,
    whatif_pos_n:            (name, pp, position) =>
      `Uma play de **${pp}pp** seria a **#${position}ª** melhor jogada de **${name}**.`,
    whatif_pos_none:         (name, pp) =>
      `Uma play de **${pp}pp** não entraria no top 100 de **${name}**.`,
    whatif_gain:             (gain, total) =>
      `O PP dele(a) mudaria em **+${gain}pp**, indo para **${total}pp**.`,
    whatif_top5:             'Top 5 (com a simulação):',
    whatif_hypothetical:     'hipotética',
  },

  en: {
    locale:                  'en-US',

    player_not_found:        '❌ Player not found.',
    error_generic:           '❌ An error occurred while fetching data.',
    no_link_set:             '❌ You have no link set. Use `/link set` or provide a player name.',
    cooldown_wait:           (secs) => `⏳ Slow down! Try again in **${secs}s**.`,

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
    link_status_header:      '🔗 Your links:',
    link_status_line:        (label, user, isDefault) =>
      `• **${label}** — ${user}${isDefault ? '  ⭐ *(default)*' : ''}`,
    link_status_hint:        'The ⭐ server is used when you don\'t pass the `server` option.',
    link_removed:            '✅ Link removed successfully.',
    link_removed_server:     (label) => `✅ **${label}** link removed.`,
    link_removed_all:        (n) => `✅ Removed ${n} link(s).`,
    link_nothing_to_remove:  '❌ You had no link to remove.',
    link_not_found:          '❌ Player not found. Check the name and server.',
    link_success_title:      '✅ Link set!',
    link_success_desc:       (user, label) =>
      `Your Discord account has been linked to **${user}** on **${label}**.\n\n` +
      `**${label}** is now your default server — commands without the \`server\` option will use it. ` +
      `You can have one link per server and change the default with \`/link default\`.`,
    link_error:              '❌ An error occurred while verifying the player.',
    link_default_set:        (label) => `✅ Default server set to **${label}**.`,
    link_default_missing:    (label) => `❌ You have no link on **${label}**. Use \`/link set\` on that server first.`,
    no_link_for_server:      (label) =>
      `❌ You have no link on **${label}**. Use \`/link set\` to link your account on that server, ` +
      `or provide a player name in the command.`,

    lang_set:                (lang) => `✅ Language set to **${lang}**.`,
    lang_set_server:         (lang) => `✅ Server language set to **${lang}**.`,
    lang_reset_server:       '✅ Server language reset to default.',
    lang_no_permission:      '❌ You need **Administrator** permission to change the server language.',
    lang_current_user:       (lang) => `🌐 Your current language: **${lang}**`,
    lang_current_server:     (lang) => `🌐 Server language: **${lang}**`,
    lang_current_none:       '🌐 No language set (using default: English).',

    simulate_invalid_map:    "❌ Couldn't identify the map. Use the beatmap ID or a link (e.g. `https://osu.ppy.sh/beatmapsets/123#osu/456`).",
    simulate_map_not_found:  '❌ Map not found.',
    simulate_calc_error:     "❌ Couldn't calculate pp for this simulation. Check if the values make sense for the map.",
    simulate_error:          '❌ An error occurred while simulating the play.',
    simulate_mods_none:      'None',
    simulate_title:          'PP Simulation',
    simulate_combo_fc:       'Full Combo',
    simulate_combo_assumed:  'max combo assumed',
    simulate_footer:         (label) => `Simulation • ${label}`,

    // Shared between /pp and /whatif
    no_plays:                (name, label) => `**${name}** has no plays on ${label}.`,
    footer_based_on:         (label, count) => `${label} • based on top ${count} plays`,

    pp_already:              (name, current, target) =>
      `**${name}** already has **${current}pp**, which is at or above **${target}pp**! 🎉`,
    pp_title:                (name, target) => `What score does ${name} need to reach ${target}pp?`,
    pp_desc_best:            (name, target, required) =>
      `To reach **${target}pp** with a single score, **${name}** would need a play worth ` +
      `**${required}pp** — that would be their new **#1** best play! 🎉`,
    pp_desc_position:        (name, target, required, position) =>
      `To reach **${target}pp** with a single score, **${name}** would need a play worth ` +
      `**${required}pp**, which would be their **#${position}** best play.`,

    whatif_title:            (name, pp) => `What if ${name} got a new ${pp}pp score?`,
    whatif_pos_best:         (name, pp) =>
      `A **${pp}pp** play would be **${name}**'s new **#1** best play! 🎉`,
    whatif_pos_n:            (name, pp, position) =>
      `A **${pp}pp** play would be **${name}**'s **#${position}** best play.`,
    whatif_pos_none:         (name, pp) =>
      `A **${pp}pp** play wouldn't enter **${name}**'s top 100.`,
    whatif_gain:             (gain, total) =>
      `Their pp would change by **+${gain}pp**, going to **${total}pp**.`,
    whatif_top5:             'Top 5 (with the simulation):',
    whatif_hypothetical:     'hypothetical',
  },

  ru: {
    locale:                  'ru-RU',

    player_not_found:        '❌ Игрок не найден.',
    error_generic:           '❌ Произошла ошибка при получении данных.',
    no_link_set:             '❌ У вас не привязан аккаунт. Используйте `/link set` или укажите имя игрока.',
    cooldown_wait:           (secs) => `⏳ Не так быстро! Попробуйте снова через **${secs}с**.`,

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
    link_status_header:      '🔗 Ваши привязки:',
    link_status_line:        (label, user, isDefault) =>
      `• **${label}** — ${user}${isDefault ? '  ⭐ *(по умолчанию)*' : ''}`,
    link_status_hint:        'Сервер с ⭐ используется, когда вы не указываете опцию `server`.',
    link_removed:            '✅ Привязка успешно удалена.',
    link_removed_server:     (label) => `✅ Привязка **${label}** удалена.`,
    link_removed_all:        (n) => `✅ Удалено привязок: ${n}.`,
    link_nothing_to_remove:  '❌ У вас не было привязки для удаления.',
    link_not_found:          '❌ Игрок не найден. Проверьте имя и сервер.',
    link_success_title:      '✅ Привязка установлена!',
    link_success_desc:       (user, label) =>
      `Ваш Discord-аккаунт привязан к **${user}** на **${label}**.\n\n` +
      `**${label}** теперь ваш сервер по умолчанию — команды без опции \`server\` будут использовать его. ` +
      `Можно иметь по привязке на каждый сервер и менять умолчание через \`/link default\`.`,
    link_error:              '❌ Произошла ошибка при проверке игрока.',
    link_default_set:        (label) => `✅ Сервер по умолчанию: **${label}**.`,
    link_default_missing:    (label) => `❌ У вас нет привязки на **${label}**. Сначала используйте \`/link set\` там.`,
    no_link_for_server:      (label) =>
      `❌ У вас нет привязки на **${label}**. Используйте \`/link set\`, чтобы привязать аккаунт этого сервера, ` +
      `или укажите имя игрока в самой команде.`,

    lang_set:                (lang) => `✅ Язык установлен: **${lang}**.`,
    lang_set_server:         (lang) => `✅ Язык сервера установлен: **${lang}**.`,
    lang_reset_server:       '✅ Язык сервера сброшен на стандартный.',
    lang_no_permission:      '❌ Вам нужны права **Администратора**, чтобы изменить язык сервера.',
    lang_current_user:       (lang) => `🌐 Ваш текущий язык: **${lang}**`,
    lang_current_server:     (lang) => `🌐 Язык сервера: **${lang}**`,
    lang_current_none:       '🌐 Язык не установлен (используется стандартный: Русский).',

    simulate_invalid_map:    '❌ Не удалось определить карту. Укажите ID карты или ссылку (например: `https://osu.ppy.sh/beatmapsets/123#osu/456`).',
    simulate_map_not_found:  '❌ Карта не найдена.',
    simulate_calc_error:     '❌ Не удалось рассчитать PP для этой симуляции. Проверьте, подходят ли значения для карты.',
    simulate_error:          '❌ Произошла ошибка при симуляции плея.',
    simulate_mods_none:      'Нет',
    simulate_title:          'Симуляция PP',
    simulate_combo_fc:       'Full Combo',
    simulate_combo_assumed:  'предполагается макс. комбо',
    simulate_footer:         (label) => `Симуляция • ${label}`,

    // Общее для /pp и /whatif
    no_plays:                (name, label) => `У **${name}** нет плеев на ${label}.`,
    footer_based_on:         (label, count) => `${label} • на основе топ ${count} плеев`,

    pp_already:              (name, current, target) =>
      `У **${name}** уже **${current}pp**, что не меньше **${target}pp**! 🎉`,
    pp_title:                (name, target) => `Какой скор нужен ${name}, чтобы достичь ${target}pp?`,
    pp_desc_best:            (name, target, required) =>
      `Чтобы достичь **${target}pp** одним скором, **${name}** нужно сделать плей на ` +
      `**${required}pp** — это стал бы новый **#1** топ плей! 🎉`,
    pp_desc_position:        (name, target, required, position) =>
      `Чтобы достичь **${target}pp** одним скором, **${name}** нужно сделать плей на ` +
      `**${required}pp** — это был бы **#${position}** топ плей.`,

    whatif_title:            (name, pp) => `Что если бы ${name} сделал(а) плей на ${pp}pp?`,
    whatif_pos_best:         (name, pp) =>
      `Плей на **${pp}pp** стал бы новым **#1** топ плеем **${name}**! 🎉`,
    whatif_pos_n:            (name, pp, position) =>
      `Плей на **${pp}pp** был бы **#${position}** топ плеем **${name}**.`,
    whatif_pos_none:         (name, pp) =>
      `Плей на **${pp}pp** не попал бы в топ 100 **${name}**.`,
    whatif_gain:             (gain, total) =>
      `PP изменился бы на **+${gain}pp**, до **${total}pp**.`,
    whatif_top5:             'Топ 5 (с симуляцией):',
    whatif_hypothetical:     'гипотетический',
  },
};

// ─── Resolução de idioma ──────────────────────────────────────────────────────

/**
 * Retorna as strings de tradução para a interação.
 * Prioridade: usuário > servidor > 'pt' (default)
 */
function t(interaction) {
  const userLang   = db.getUserLang(interaction.user.id);
  const serverLang = interaction.guildId ? db.getServerLang(interaction.guildId) : null;
  const lang       = userLang ?? serverLang ?? 'pt';
  return translations[lang] ?? translations['pt'];
}

const SUPPORTED_LANGS = { pt: 'Português', en: 'English', ru: 'Русский' };

module.exports = { t, SUPPORTED_LANGS };

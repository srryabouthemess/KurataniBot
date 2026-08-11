/**
 * i18n/ru.js
 * Strings em Русский.
 *
 * Recebe `ADMIN`, o rótulo do servidor que os comandos administrativos
 * operam — ele vem da configuração, para as mensagens não dizerem o nome de um
 * servidor específico num bot hospedado para outro.
 */

module.exports = ({ ADMIN }) => ({
  locale:                  'ru-RU',

  player_not_found:        '❌ Игрок не найден.',
  error_generic:           '❌ Произошла ошибка при получении данных.',
  no_link_set:             '❌ У вас не привязан аккаунт. Используйте `/link set` или укажите имя игрока.',
  cooldown_wait:           (secs) => `⏳ Не так быстро! Попробуйте снова через **${secs}с**.`,

  // ── Текстовые команды (префикс) ───────────────────────────────────────────
  prefix_usage:            (usage) => `❌ Использование: \`${usage}\``,
  prefix_missing_option:   (name, usage) => `❌ Не указано \`${name}\`.\n-# Использование: \`${usage}\``,
  prefix_extra_args:       (usage) => `❌ Слишком много аргументов. Если в имени есть пробелы, возьмите его в кавычки: \`"имя с пробелами"\`.\n-# Использование: \`${usage}\``,
  prefix_invalid_choice:   (name, accepted) => `❌ Неверное значение для \`${name}\`. Допустимо: ${accepted}.`,
  prefix_unknown_flag:     (flag, accepted) => `❌ Неизвестный флаг \`${flag}\`. В этой команде доступны: ${accepted}.`,
  prefix_no_flags:         (flag, usage) => `❌ У этой команды нет флагов вроде \`${flag}\`.\n-# Использование: \`${usage}\``,
  prefix_invalid_integer:  (name) => `❌ \`${name}\` должно быть целым числом.`,
  prefix_invalid_number:   (name) => `❌ \`${name}\` должно быть числом.`,
  prefix_out_of_range:     (name, range) => `❌ \`${name}\` вне допустимого диапазона (${range}).`,
  prefix_too_long:         (name, max) => `❌ \`${name}\` длиннее ${max} символов.`,
  prefix_too_short:        (name, min) => `❌ \`${name}\` должно быть не короче ${min} символов.`,
  prefix_invalid_boolean:  (name) => `❌ \`${name}\` принимает только да/нет.`,
  prefix_user_not_found:   (name) => `❌ Не нашёл пользователя в \`${name}\` — упомяните его (@кто-то) или укажите ID.`,
  prefix_guild_only:       '❌ Эта команда работает только на сервере.',
  prefix_no_permission:    '❌ У вас нет прав на использование этой команды.',

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

  score_no_map:            '❌ Укажите карту (ID или ссылку) — недавних карт в этом канале не нашлось.',
  score_none:              (name, map, label) => `У **${name}** нет скоров на **${map}** в ${label}.`,
  score_no_mods:           'No Mods',
  score_footer:            (page, total, count, label) => `Страница ${page}/${total} • скоров: ${count} • ${label}`,
  score_error:             'Ошибка при получении скоров на этой карте.',

  compare_title:           'Сравнение osu!',
  compare_not_found:       '❌ Один или оба игрока не найдены.',
  compare_need_user1:      '❌ Укажите хотя бы первого игрока, или используйте `/link set`, чтобы привязать аккаунт.',
  compare_need_user2:      '❌ Укажите второго игрока для сравнения.',
  compare_footer:          (user, label) => `Запрошено ${user} • ${label}`,
  compare_error:           'Ошибка при сравнении игроков. Проверьте правильность никнеймов.',

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

  pp_howmany_title:        (name, target) => `Сколько плеев нужно ${name}, чтобы достичь ${target}pp?`,
  pp_target_unreachable:   (target) => `❌ **${target}pp** слишком много для расчёта — даже невероятный плей не дотянет. Возьмите цель поменьше.`,
  pp_howmany_desc_progressive: (name, target, count, value, last, step) =>
    `Чтобы достичь **${target}pp**, **${name}** понадобится примерно **${count}** плей(ев): ` +
    `начиная с **${value}pp** и повышаясь на **${step}pp** за плей до **${last}pp**.`,
  pp_howmany_desc_randomized: (name, target, count, value, last, step, min, max, pct) =>
    `Чтобы достичь **${target}pp**, **${name}** понадобится примерно **${count}** плей(ев): ` +
    `рост с **${value}pp** примерно до **${last}pp** (+${step}pp за плей), ` +
    `где каждый плей колеблется на **±${pct}%** — разброс, измеренный по его топ плеям — ` +
    `что дало значения от **${min}pp** до **${max}pp**.`,
  pp_howmany_impossible:   (name, value, cap) =>
    `❌ Даже **${cap}** плеев, начиная с **${value}pp**, не приведут **${name}** к этой цели. ` +
    `Попробуйте значение повыше.`,

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

  // ── Администрирование сервера (/nominate, /moderate) ──────────────────────
  admin_not_configured:    '❌ Административные команды не настроены на этом боте (отсутствует `DAYCORE_GUILD_ID` в `.env`).',
  admin_wrong_guild:       `❌ Эта команда работает только на Discord-сервере ${ADMIN}.`,
  admin_not_staff:         `❌ Вы не зарегистрированы как персонал ${ADMIN}. Администратор должен добавить вас через \`/staff register\`.`,
  admin_priv_fetch_failed: `❌ Сейчас не удалось получить ваши привилегии на ${ADMIN}. Попробуйте позже.`,
  admin_missing_priv:      (role) => `❌ У вас нет прав для этого на ${ADMIN} (ваша роль там: **${role}**).`,
  admin_redis_unconfigured:`❌ Подключение к ${ADMIN} не настроено (отсутствует \`REDIS_HOST\` в \`.env\`). Без него бот не может применять изменения на сервере.`,
  admin_redis_unreachable: (err) => `❌ Сейчас нет связи с ${ADMIN} (Redis недоступен${err ? `: ${err}` : ''}). Ничего не изменено.`,
  admin_action_failed:     '❌ Произошла ошибка при выполнении действия. Ничего не подтверждено — проверьте состояние перед повтором.',

  nom_invalid_map:         '❌ Не удалось определить карту. Укажите ID карты/сета или ссылку.',
  nom_map_not_found:       `❌ Карта не найдена на ${ADMIN}.`,
  nom_set_line:            (setId, diffs) => `Сет \`${setId}\` — сложностей: ${diffs}`,
  nom_added_title:         (status) => `Номинация записана (${status})`,
  nom_progress:            (have, need) => `**${have}/${need}** номинаций.`,
  nom_by:                  (who) => `Номинировали: ${who}`,
  nom_threshold_reached:   (need) => `✅ Порог в **${need}** номинаций достигнут — применяю на ${ADMIN}.`,
  nom_applied_title:       (status) => `Статус применён: ${status}`,
  nom_all_confirmed:       (n) => `✅ Подтверждено для **${n}** сложностей.`,
  nom_none_confirmed:      (n) => `⚠️ Опубликовано для **${n}** сложностей, но пока ничего не подтвердилось. Bancho может ещё обрабатывать — проверьте позже.`,
  nom_partial:             (ok, total, ids) => `⚠️ Подтверждено **${ok}/${total}**. Без подтверждения: \`${ids}\`.`,
  nom_withdrawn:           (label, left, need) => `✅ Номинация с **${label}** снята. Сейчас: **${left}/${need}**.`,
  nom_nothing_to_withdraw: (label) => `❌ У вас не было номинации на **${label}**.`,
  nom_queue_title:         '📋 Карты, ожидающие номинации',
  nom_queue_empty:         'В очереди номинаций пусто.',
  nom_queue_line:          (setId, name, status, votes, need) =>
    `• \`${setId}\` **${name}** → ${status} (**${votes}/${need}**)`,
  nom_actor:               (name) => `Действие от ${name}`,

  mod_check_title:         (name) => `Привилегии ${name}`,
  mod_check_body:          (id, role, priv, state) =>
    `ID: \`${id}\`\nРоль: **${role}**\n\`priv\`: \`${priv}\`\nСостояние: ${state}`,
  mod_restricted:          '🔴 **Ограничен**',
  mod_not_restricted:      '🟢 Без ограничений',
  mod_cannot_self:         '❌ Нельзя применить это к своему аккаунту.',
  mod_already_restricted:  (name) => `❌ **${name}** уже ограничен.`,
  mod_not_currently_restricted: (name) => `❌ **${name}** не ограничен.`,
  mod_restrict_title:      'Игрок ограничен',
  mod_unrestrict_title:    'Ограничение снято',
  mod_action_body:         (name, id, reason) => `**${name}** (\`${id}\`)\nПричина: ${reason}`,
  mod_confirmed:           `✅ Подтверждено на ${ADMIN}.`,
  mod_unconfirmed:         '⚠️ Запрос опубликован, но подтвердить эффект не удалось. Проверьте через `/moderate check`.',
  mod_log_title:           '📜 Недавние действия через бота',
  mod_log_empty:           'Действий пока не записано.',
  mod_log_line:            (when, action, target, actor, detail) =>
    `\`${when}\` **${action}** \`${target}\` — ${actor}${detail ? ` (${detail})` : ''}`,

  staff_need_admin:        '❌ Для управления привязками персонала нужны права **Администратора** в этом Discord.',
  staff_list_title:        `🔑 Привязки персонала ${ADMIN}`,
  staff_list_empty:        'Привязок персонала нет. Используйте `/staff register`.',
  staff_list_line:         (discordId, osuName, osuId) => `• <@${discordId}> → **${osuName}** (\`${osuId}\`)`,
  staff_registered_title:  '✅ Привязка персонала создана',
  staff_registered_body:   (discordId, osuName, osuId, role) =>
    `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Текущая роль на ${ADMIN}: **${role}**

` +
    `Сама привязка ничего не даёт: права берутся из роли на ${ADMIN} и проверяются при каждой команде.`,
  staff_removed:           (discordId) => `✅ Привязка <@${discordId}> удалена.`,
  staff_nothing_to_remove: (discordId) => `❌ У <@${discordId}> не было привязки персонала.`,
});

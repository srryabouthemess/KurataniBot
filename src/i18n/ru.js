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
  // Ответ на префикс, отправленный сам по себе — человек только знакомится с ботом.
  prefix_welcome:          (prefix) =>
    '👋 Привет! Я показываю статистику osu! здесь, в Discord.\n' +
    'Начните с `/link set <ваш ник>` — после этого `/profile`, `/recent` и `/topplays` уже знают, кто вы.\n' +
    `Чтобы увидеть всё, что я умею, используйте \`/help\` (или \`${prefix}help\`).`,

  // ── /help ─────────────────────────────────────────────────────────────────
  // Порядок и группировка команд — в commands/help.js; здесь только тексты.
  help_title:              'Команды KurataniBot',
  help_intro:              'Статистика osu! в Discord.\n' +
                           'Выполните `/link set` один раз — и остальные команды уже знают, кто вы.',
  help_group_stats:        '📊 Профиль и плеи',
  help_group_pp:           '💭 PP и симуляции',
  help_group_config:       '⚙️ Настройки',
  help_group_admin:        `🛡️ Администрирование ${ADMIN}`,
  help_cmd_profile:        'Профиль игрока: ранки, точность и лучший плей.',
  help_cmd_recent:         'Последние плеи, включая проваленные.',
  help_cmd_topplays:       'Лучшие плеи, по 5 на странице.',
  help_cmd_score:          'Скоры на карте и сколько PP дал бы каждый при FC.',
  help_cmd_compare:        'Сравнение двух игроков.',
  help_cmd_leaderboard:    'Рейтинг pp сервера, по 10 на странице.',
  help_cmd_topscores:      'Лучшие плеи всего сервера (только bancho.py).',
  help_cmd_whatif:         'Сколько PP принесёт новый плей.',
  help_cmd_pp:             'Чего не хватает до нужного количества PP.',
  help_cmd_map:            'Карта и сколько PP дал бы FC на ней при 95–100%.',
  help_cmd_simulate:       'Сколько PP дал бы конкретный плей на карте.',
  help_cmd_link:           'Привязка аккаунта osu! к Discord.',
  help_cmd_language:       'Смена языка: Português, English или Русский.',
  help_cmd_nominate:       'Номинация карт для смены статуса.',
  help_cmd_moderate:       'Просмотр и ограничение аккаунтов.',
  help_cmd_wipe:           'Удаление скоров аккаунта в одном режиме (необратимо).',
  help_cmd_scorewipe:      'Удаление одного скора игрока.',
  help_cmd_staff:          'Управление привязками стаффа.',
  help_cmd_role:           'Выдача и снятие ролей сервера.',
  help_servers:            '🌐 Доступные серверы',
  help_modo:               'На серверах с Relax `modo:` выбирает VN или RX (`-vn`, `-rx`). Значение по умолчанию задаётся в `/link`.',
  help_prefix:             '⌨️ Текстовые команды',
  help_prefix_body:        (prefix) => `Те же команды работают текстом: \`${prefix}rs mrekk\`.`,
  help_footer:             'В командах со страницами листайте кнопками ◀️ ▶️.',

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
  // `recorte` ("12/100 plays") приходит только когда фильтр что-то отсёк, и
  // через i18n не проходит: это число с единицей, как строки рейтинга (см.
  // примечание к leaderboard_title). `plays` остаётся по-английски.
  topplays_footer:         (page, total, label, recorte = null) =>
    [`Страница ${page}/${total}`, recorte, 'osu', label].filter(Boolean).join(' • '),
  topplays_none_match:     'Нет плеев, подходящих под эти фильтры.',
  topplays_bad_mods:       (input) => `❌ В \`${input}\` не распознан ни один мод. Используйте акронимы (\`HDDT\`) или \`NM\` для плеев без модов.`,
  topplays_error:          'Ошибка при получении топ плеев.',
  pagination_not_yours:    '❌ Только автор команды может переключать страницы.',

  // ── /leaderboard ──────────────────────────────────────────────────────────
  // Строка каждого места — это только числа с единицами ("12 753,00pp",
  // "95,74%", "498 plays"), поэтому сюда она не попадает. `plays` остаётся
  // по-английски — жаргон osu!, одинаковый на любом языке игры.
  leaderboard_title:           (label) => `Рейтинг pp — ${label}`,
  leaderboard_title_country:   (label, country) => `Рейтинг pp — ${label} — ${country}`,
  leaderboard_none:            (label) => `В рейтинге **${label}** пока никого нет.`,
  leaderboard_none_country:    (label, country) => `В рейтинге **${label}** нет игроков из **${country}**.`,
  leaderboard_invalid_country: '❌ Укажите двухбуквенный код страны (например `BR`, `US`, `RU`).',
  leaderboard_error:           'Ошибка при получении рейтинга сервера.',
  leaderboard_footer:          (page, total, label) => `Страница ${page}/${total} • ${label}`,

  // ── /topscores ────────────────────────────────────────────────────────────
  topscores_title:             (label) => `Лучшие плеи — ${label}`,
  topscores_footer:            (page, total, label, hidden) =>
    `Страница ${page}/${total} • ${label}${hidden ? ` • скрыто: ${hidden}` : ''}`,
  topscores_none:              (label) => `На **${label}** ещё нет ни одного плея.`,
  topscores_error:             'Ошибка при получении лучших плеев сервера.',
  // Причина идёт вместе с отказом: без неё ответ выглядит как сбой бота, и его
  // просто повторяют. См. заголовок commands/topscores.js.
  topscores_unsupported:       (label) =>
    `❌ **${label}** не публикует лучшие плеи сервера — в его API нет такого эндпоинта. ` +
    `Это работает на серверах bancho.py. Для лучших плеев игрока используйте \`/topplays\`.`,
  topscores_too_big:           (label) =>
    `❌ На **${label}** слишком много скоров, чтобы собрать этот список надёжно. ` +
    `API не умеет сортировать по pp, значит пришлось бы перебрать всю таблицу — а перебор наполовину ` +
    `дал бы пьедестал, который не пьедестал. Лучше не ответить, чем ответить неверно.`,

  recent_none:             (name) => `Недавних плеев для **${name}** не найдено.`,
  recent_error:            'Ошибка при получении последнего плея. Проверьте, существует ли игрок.',
  recent_footer:           (page, total, label, status, mapper) =>
    `${status ? `${status} • ` : ''}${mapper ? `карта от ${mapper} • ` : ''}Плей ${page}/${total} • ${label}`,

  score_no_map:            '❌ Укажите карту (ID или ссылку) — недавних карт в этом канале не нашлось.',
  score_none:              (name, map, label) => `У **${name}** нет скоров на **${map}** в ${label}.`,
  score_footer:            (page, total, count, label, status, mapper) =>
    `${status ? `${status} • ` : ''}${mapper ? `карта от ${mapper} • ` : ''}` +
    `Страница ${page}/${total} • скоров: ${count} • ${label}`,
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
  link_default_set_modo:   (label, modo) => `✅ Сервер по умолчанию: **${label}**, режим **${modo}**.`,
  link_modo_note:          (modo) => `Текущий режим: **${modo}**. Изменить можно через \`/link default\`.`,
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

  // Общая для /simulate и /map: оба принимают моды текстом и считают по ним.
  // Молча отброшенный токен даёт pp, который выглядит ответом на заданный
  // вопрос, но относится к другому плею.
  mods_bad:                (input) => `❌ Не понял \`${input}\` в модах. Используйте акронимы (\`HDDT\`), а для смены скорости добавьте рейт: \`DT1.4\` (DT и NC от 1.01x до 2x, HT и DC от 0.5x до 0.99x).`,

  simulate_invalid_map:    '❌ Не удалось определить карту. Укажите ID карты или ссылку (например: `https://osu.ppy.sh/beatmapsets/123#osu/456`).',
  simulate_map_not_found:  '❌ Карта не найдена.',
  simulate_calc_error:     '❌ Не удалось рассчитать PP для этой симуляции. Проверьте, подходят ли значения для карты.',
  simulate_error:          '❌ Произошла ошибка при симуляции плея.',
  simulate_title:          'Симуляция PP',
  simulate_combo_fc:       'Full Combo',
  simulate_combo_assumed:  'предполагается макс. комбо',
  simulate_footer:         (label) => `Симуляция • ${label}`,

  // ── /map ──────────────────────────────────────────────────────────────────
  // Сама таблица pp сюда не попадает: это `95%` рядом со значением pp, что
  // читается одинаково на любом языке (то же решение, что и у эмбеда плея
  // насчёт подписей).
  map_no_file:             '❌ Не удалось прочитать файл этой карты, поэтому таблицы pp нет.',
  map_footer:              (label, status, mapper) =>
    [status, mapper ? `карта от ${mapper}` : null, label].filter(Boolean).join(' • '),
  map_error:               '❌ Произошла ошибка при получении этой карты.',

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
  admin_redis_unreachable: `❌ Сейчас нет связи с ${ADMIN} (Redis недоступен). Ничего не изменено.`,
  admin_action_failed:     '❌ Произошла ошибка при выполнении действия. Ничего не подтверждено — проверьте состояние перед повтором.',
  admin_log_failed:        '⚠️ **Не удалось записать это в журнал аудита бота** — `/moderate log` не покажет это действие. То, что выше, — единственная оставшаяся запись: скопируйте её, прежде чем закрыть.',

  ann_title:               (status) => `Карта теперь ${status}`,
  ann_diffs:               (n) => `сложностей на ${ADMIN}: ${n}`,
  ann_by:                  (who) => `Применил: ${who}`,
  ann_by_ingame:           (who) => `Применил ${who}, из игры`,
  ann_ingame_unknown:      'Применено из игры',

  // Лог ролей, изменённых ИЗ ИГРЫ. То, что проходит через /role и админ-панель,
  // уже уходит эмбедом через вебхук аудита самого сервера.
  priv_ann_title_give:     'Роль выдана из игры',
  priv_ann_title_take:     'Роль снята из игры',
  priv_ann_roles:          (roles) => `Роли: **${roles}**`,
  priv_ann_by_ingame:      (who) => `Применил ${who}, из игры`,
  priv_ann_ingame_unknown: 'Применено из игры',

  nom_invalid_map:         '❌ Не удалось определить карту. Укажите ID карты/сета или ссылку.',
  nom_map_not_found:       `❌ Карта не найдена ни на ${ADMIN}, ни на osu!.`,
  nom_not_on_server:       `ℹ️ Карты пока нет на ${ADMIN} — сложности взяты с osu!, сервер загрузит её при применении статуса.`,
  nom_queue_not_cleared:   '⚠️ Не удалось очистить очередь номинаций этого сета — в ней остались голоса за состояние, которое уже изменилось. Используйте `/nominate withdraw`, если они мешают.',
  nom_publish_interrupted: (published, total) => `⚠️ Публикация остановилась на **${published}/${total}** сложностях (сбой связи с ${ADMIN}). Уже отправленные всё равно применятся — запустите снова, чтобы завершить остальные.`,
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
  mod_target_is_staff:     (name, role) => `❌ **${name}** — сотрудник сервера (${role}), а модерировать сотрудников может только **Developer**. Ничего не опубликовано.`,

  role_give_title:         (role) => `Роль выдана: ${role}`,
  role_take_title:         (role) => `Роль снята: ${role}`,
  role_body:               (name, id, role, reason) =>
    `**${name}** (\`${id}\`)\nРоль: **${role}**\nПричина: ${reason}`,
  role_already_has:        (name, role) => `❌ У **${name}** уже есть **${role}**.`,
  role_missing:            (name, role) => `❌ У **${name}** нет **${role}**.`,

  wipe_confirm_title:      '⚠️ Подтвердите удаление скоров',
  wipe_confirm_body:       (name, id, mode) => `Цель: **${name}** (\`${id}\`)\nРежим: **${mode}**`,
  wipe_stats_line:         (pp, plays, acc, combo, hits) => `Будет удалено:\n• **${pp}pp**\n• плеев: **${plays}**\n• точность **${acc}%**\n• макс. комбо **${combo}x**\n• всего хитов: **${hits}**`,
  wipe_no_stats:           '⚠️ Не удалось прочитать текущую статистику — не могу сказать, сколько будет удалено.',
  wipe_irreversible:       '**Это необратимо.** Скоры удаляются из базы, статистика обнуляется; восстановить не сможет даже владелец сервера.',
  wipe_button_confirm:     'Всё равно удалить',
  wipe_button_cancel:      'Отмена',
  wipe_cancelled:          '✅ Отменено. Ничего не удалено.',
  wipe_expired:            '⏲️ Время подтверждения истекло. Ничего не удалено.',
  wipe_done_title:         (mode) => `Скоры удалены (${mode})`,
  wipe_done_body:          (name, id, mode) => `**${name}** (\`${id}\`) — режим **${mode}**`,
  wipe_confirmed:          '✅ Подтверждено: pp и плеи обнулены на сервере.',
  wipe_unconfirmed:        '⚠️ Опубликовано, но эффект пока не подтверждён. Проверьте профиль перед повтором — повтор уже сработавшего wipe ничего не отменяет, но и повтор по ошибке не поможет.',

  // ── /scorewipe ───────────────────────────────────────────────────────────────
  scorewipe_not_found:     (id) => `❌ Скор \`${id}\` на сервере не найден.`,
  scorewipe_other_player:  (id, owner) => `❌ Скор \`${id}\` принадлежит другому игроку (\`${owner}\`). Ничего не удалено.`,
  scorewipe_other_mode:    (id, mode) => `❌ Скор \`${id}\` из режима **${mode}**. Запустите снова с этим режимом или проверьте id.`,
  scorewipe_no_scores:     (name, mode) => `У **${name}** нет плеев в **${mode}**, которые можно показать.`,
  scorewipe_pick_title:    'Выберите скор',
  scorewipe_pick_body:     (name, id, mode) => `Цель: **${name}** (\`${id}\`)\nРежим: **${mode}**`,
  scorewipe_pick_placeholder: 'Какой плей удалить',
  scorewipe_map_unknown:   'неизвестная карта',
  scorewipe_score_line:    (map, pp, acc, mods, grade, when) => `**${map}**\n• **${pp}pp** ${mods}\n• **${grade}** · точность **${acc}%**\n• сыграно ${when}`,
  scorewipe_already:       (id) => `Скор \`${id}\` уже удалён. Ничего не опубликовано.`,
  scorewipe_confirm_title: '⚠️ Подтвердите удаление скора',
  scorewipe_confirm_body:  (name, id, mode) => `Цель: **${name}** (\`${id}\`)\nРежим: **${mode}**`,
  scorewipe_was_best:      '⚠️ Это его лучший скор на карте: место займёт второй результат, и pp упадёт только на разницу между ними.',
  scorewipe_reversible:    'Скор уходит из лидербордов, топ-плеев и суммы pp. Строка остаётся в базе (статус `-1`), поэтому это можно отменить — но только в самой базе: у бота команды для этого нет.',
  scorewipe_button_confirm: 'Удалить этот скор',
  scorewipe_cancelled:     '✅ Отменено. Ничего не удалено.',
  scorewipe_expired:       '⏲️ Время подтверждения истекло. Ничего не удалено.',
  scorewipe_done_title:    'Скор удалён',
  scorewipe_done_body:     (name, id, scoreId) => `**${name}** (\`${id}\`) — скор \`${scoreId}\``,
  scorewipe_confirmed:     '✅ Подтверждено: сервер пометил скор как удалённый.',
  scorewipe_unconfirmed:   '⚠️ Опубликовано, но эффект пока не подтверждён. Проверьте профиль перед повтором.',
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
  staff_list_duplicate:    '⚠️ повтор аккаунта',
  staff_proof_self:        '`подтверждён`',
  staff_proof_vouch:       '`поручительство`',
  staff_proof_legacy:      '`старый`',
  staff_proof_legend:      '-# `подтверждён` = человек доказал владение аккаунтом и может ручаться за других (если Developer). `поручительство` = создан подтверждённым Developer. `старый` = создан до появления проверки; действует, но ни за кого не ручается.',
  staff_vouched_note:      (voucher) => `Привязано без кода: поручился **${voucher}** — Developer, подтвердивший собственный аккаунт.`,
  staff_osu_already_linked:(discordId, osuName, osuId) => `❌ Аккаунт **${osuName}** (\`${osuId}\`) уже привязан к <@${discordId}>. Сначала выполните \`/staff remove\` для того участника — два Discord-аккаунта на одном игровом не дают журналу аудита понять, кто именно действовал.`,
  staff_challenge_title:   '🔑 Ожидается подтверждение',
  staff_challenge_body:    (discordId, osuName, osuId, role, code, minutes) =>
    `Запрошена привязка: <@${discordId}> → **${osuName}** (\`${osuId}\`, ${role})\n\n` +
    `**Пока ничего не привязано.** Чтобы завершить, <@${discordId}> нужно:\n` +
    `1. Войти в аккаунт **${osuName}** на сайте сервера и вписать этот код в профиль (поле «обо мне»):\n` +
    `\`\`\`\n${code}\n\`\`\`\n` +
    `2. Выполнить \`/staff confirm\` здесь.\n\n` +
    `Код действует **${minutes} минут**. Редактировать тот профиль может только тот, кто вошёл в аккаунт — это и доказывает, что аккаунт его.`,
  staff_link_unchanged:    (discordId, osuName, osuId, role) =>
    `ℹ️ <@${discordId}> уже привязан к **${osuName}** (\`${osuId}\`, ${role}). Ничего не изменилось, подтверждать заново не нужно.\n\nЧтобы снова потребовать подтверждение владения, сначала выполните \`/staff remove\` для этого участника.`,
  staff_no_challenge:      '❌ У вас нет ожидающих привязок. Попросите администратора сначала выполнить `/staff register` с вашим аккаунтом.',
  staff_code_not_found:    (osuName, code) =>
    `❌ Не нашёл код в профиле **${osuName}**.\n\nВпишите \`${code}\` в поле «обо мне», сохраните и снова выполните \`/staff confirm\`. Если только что сохранили — подождите несколько секунд.`,
  staff_code_can_be_removed: 'Код из профиля можно убрать.',
  staff_registered_title:  '✅ Привязка персонала создана',
  staff_registered_body:   (discordId, osuName, osuId, role) =>
    `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Текущая роль на ${ADMIN}: **${role}**

` +
    `Сама привязка ничего не даёт: права берутся из роли на ${ADMIN} и проверяются при каждой команде.`,
  staff_removed:           (discordId) => `✅ Привязка <@${discordId}> удалена.`,
  staff_nothing_to_remove: (discordId) => `❌ У <@${discordId}> не было привязки персонала.`,
  // ── /diag: диагностика ───────────────────────────────────────────────────
  // Названия кэшей и вёдер — это идентификаторы из кода, и они одинаковы на
  // всех трёх языках: перевод сделал бы вывод невозможно сопоставить с тем,
  // что написано в модулях.
  diag_title:             '📊 Диагностика бота',
  diag_uptime:            (texto) => `В сети **${texto}**`,
  diag_caches:            'Кэши (попадания / всего)',
  diag_limiter:           'Ограничитель запросов (вызовы, накопленное ожидание)',
  diag_workers:           'Движки PP',
  diag_worker_line:       (nome, vivo, servidos, falhas) =>
    `**${nome}**: ${vivo ? 'в сети' : 'остановлен'} — ${servidos} расчёт(ов), ${falhas} сбой(ев)`,
  diag_empty:             '_Пока ничего не записано — бот только запустился._',
});

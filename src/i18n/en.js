/**
 * i18n/en.js
 * Strings em English.
 *
 * Recebe `ADMIN`, o rótulo do servidor que os comandos administrativos
 * operam — ele vem da configuração, para as mensagens não dizerem o nome de um
 * servidor específico num bot hospedado para outro.
 */

module.exports = ({ ADMIN }) => ({
  locale:                  'en-US',

  player_not_found:        '❌ Player not found.',
  error_generic:           '❌ An error occurred while fetching data.',
  no_link_set:             '❌ You have no link set. Use `/link set` or provide a player name.',
  cooldown_wait:           (secs) => `⏳ Slow down! Try again in **${secs}s**.`,

  // ── Prefix (text) commands ────────────────────────────────────────────────
  prefix_usage:            (usage) => `❌ Usage: \`${usage}\``,
  prefix_missing_option:   (name, usage) => `❌ Missing \`${name}\`.\n-# Usage: \`${usage}\``,
  prefix_extra_args:       (usage) => `❌ Too many arguments. If a name has spaces, quote it: \`"name with spaces"\`.\n-# Usage: \`${usage}\``,
  prefix_invalid_choice:   (name, accepted) => `❌ Invalid value for \`${name}\`. Accepted: ${accepted}.`,
  prefix_unknown_flag:     (flag, accepted) => `❌ Unknown flag \`${flag}\`. This command takes: ${accepted}.`,
  prefix_no_flags:         (flag, usage) => `❌ This command has no flags like \`${flag}\`.\n-# Usage: \`${usage}\``,
  prefix_invalid_integer:  (name) => `❌ \`${name}\` must be a whole number.`,
  prefix_invalid_number:   (name) => `❌ \`${name}\` must be a number.`,
  prefix_out_of_range:     (name, range) => `❌ \`${name}\` is out of range (${range}).`,
  prefix_too_long:         (name, max) => `❌ \`${name}\` is longer than ${max} characters.`,
  prefix_too_short:        (name, min) => `❌ \`${name}\` needs at least ${min} characters.`,
  prefix_invalid_boolean:  (name) => `❌ \`${name}\` only takes yes/no.`,
  prefix_user_not_found:   (name) => `❌ Couldn't find the user in \`${name}\` — mention them (@someone) or pass the ID.`,
  prefix_guild_only:       '❌ This command only works inside a server.',
  prefix_no_permission:    '❌ You do not have permission to use this command.',
  // Reply to the prefix typed on its own — whoever does that is poking around.
  prefix_welcome:          (prefix) =>
    '👋 Hi! I show osu! stats here on Discord.\n' +
    'Start with `/link set <your name>` — after that `/profile`, `/recent` and `/topplays` already know who you are.\n' +
    `To see everything I do, use \`/help\` (or \`${prefix}help\`).`,

  // ── /help ─────────────────────────────────────────────────────────────────
  // Order and grouping live in commands/help.js; this is only the wording.
  help_title:              'KurataniBot commands',
  help_intro:              'osu! stats on Discord.\n' +
                           'Run `/link set` once and the other commands already know who you are.',
  help_group_stats:        '📊 Profile and plays',
  help_group_pp:           '💭 PP and simulations',
  help_group_config:       '⚙️ Settings',
  help_group_admin:        `🛡️ ${ADMIN} administration`,
  help_cmd_profile:        "Player profile: ranks, accuracy and their top play.",
  help_cmd_recent:         'Latest plays, failed ones included.',
  help_cmd_topplays:       'Best plays, 5 per page.',
  help_cmd_score:          'Scores on a map, with the PP each would be worth on FC.',
  help_cmd_compare:        'Compare two players side by side.',
  help_cmd_leaderboard:    "The server's pp ranking, 10 per page.",
  help_cmd_topscores:      "The whole server's best plays (bancho.py only).",
  help_cmd_whatif:         'How much PP a new play would earn you.',
  help_cmd_pp:             'What you still need to reach a PP total.',
  help_cmd_map:            'A map, with the PP a FC on it would be worth at 95–100%.',
  help_cmd_simulate:       'How much PP a specific play on a map would be worth.',
  help_cmd_link:           'Link your osu! account to Discord.',
  help_cmd_language:       'Change the language: Português, English or Русский.',
  help_cmd_nominate:       'Nominate maps to change their status.',
  help_cmd_moderate:       'Inspect and restrict accounts.',
  help_cmd_wipe:           "Erase an account's scores in one mode (irreversible).",
  help_cmd_scorewipe:      "Erase a single score of a player.",
  help_cmd_staff:          'Manage staff links.',
  help_cmd_role:           'Grant and remove server roles.',
  help_servers:            '🌐 Available servers',
  help_modo:               'On servers with Relax, `modo:` picks VN or RX (`-vn`, `-rx`). You can set a default with `/link`.',
  help_prefix:             '⌨️ Text commands',
  help_prefix_body:        (prefix) => `The same commands work written out: \`${prefix}rs mrekk\`.`,
  help_footer:             'On paged commands, use ◀️ ▶️ to browse.',

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
  // `recorte` ("12/100 plays") só chega quando um filtro tirou alguma play, e
  // não passa pelo i18n: é número com a unidade junto, como as linhas do
  // ranking (ver a nota em leaderboard_title).
  topplays_footer:         (page, total, label, recorte = null) =>
    [`Page ${page}/${total}`, recorte, 'osu', label].filter(Boolean).join(' • '),
  topplays_none_match:     'No plays match these filters.',
  topplays_bad_mods:       (input) => `❌ \`${input}\` has no mods I recognize. Use acronyms like \`HDDT\`, or \`NM\` for no mods.`,
  topplays_error:          'Error fetching top plays.',
  pagination_not_yours:    "❌ Only the person who ran the command can navigate the pages.",

  // ── /leaderboard ──────────────────────────────────────────────────────────
  // Each ranking row is numbers with their unit only ("12,753.00pp", "95.74%",
  // "498 plays"), so it never comes through here — same call the play embed
  // makes about labels.
  leaderboard_title:           (label) => `${label} pp ranking`,
  leaderboard_title_country:   (label, country) => `${label} pp ranking — ${country}`,
  leaderboard_none:            (label) => `Nobody on the **${label}** ranking yet.`,
  leaderboard_none_country:    (label, country) => `No **${country}** players on the **${label}** ranking.`,
  leaderboard_invalid_country: '❌ Use the two-letter country code (e.g. `BR`, `US`, `RU`).',
  leaderboard_error:           'Error fetching the server ranking.',
  leaderboard_footer:          (page, total, label) => `Page ${page}/${total} • ${label}`,

  // ── /topscores ────────────────────────────────────────────────────────────
  topscores_title:             (label) => `${label}'s best plays`,
  topscores_footer:            (page, total, label, hidden) =>
    `Page ${page}/${total} • ${label}${hidden ? ` • ${hidden} hidden` : ''}`,
  topscores_none:              (label) => `No plays recorded on **${label}** yet.`,
  topscores_error:             "Error fetching the server's best plays.",
  // The reason ships with the refusal: without it the answer looks like a bug
  // and people just retry. See the header of commands/topscores.js.
  topscores_unsupported:       (label) =>
    `❌ **${label}** does not publish the server's best plays — its API has no endpoint for it. ` +
    `This works on bancho.py servers. For a player's best plays, use \`/topplays\`.`,
  topscores_too_big:           (label) =>
    `❌ **${label}** has too many scores for me to build this list safely. ` +
    `The API cannot sort by pp, so I would have to scan the whole table — and half a scan ` +
    `would give a podium that is not the podium. I would rather not answer than answer wrong.`,

  recent_none:             (name) => `No recent plays found for **${name}**.`,
  recent_error:            'Error fetching recent play. Check if the player exists.',
  recent_footer:           (page, total, label, status, mapper) =>
    `${status ? `${status} • ` : ''}${mapper ? `mapset by ${mapper} • ` : ''}Play ${page}/${total} • ${label}`,

  score_no_map:            '❌ Provide a map (ID or link) — I found no recent map in this channel.',
  score_none:              (name, map, label) => `**${name}** has no scores on **${map}** in ${label}.`,
  score_footer:            (page, total, count, label, status, mapper) =>
    `${status ? `${status} • ` : ''}${mapper ? `mapset by ${mapper} • ` : ''}` +
    `Page ${page}/${total} • ${count} score(s) • ${label}`,
  score_error:             'Error fetching the scores for this map.',

  compare_title:           'osu! Comparison',
  compare_not_found:       '❌ One or both players were not found.',
  compare_need_user1:      '❌ Provide at least the first player, or use `/link set` to link your account.',
  compare_need_user2:      '❌ Provide the second player to compare.',
  compare_footer:          (user, label) => `Requested by ${user} • ${label}`,
  compare_error:           'Error comparing players. Check if the usernames are correct.',

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
  link_default_set_modo:   (label, modo) => `✅ Default server set to **${label}**, mode **${modo}**.`,
  link_modo_note:          (modo) => `Mode in use: **${modo}**. Change it anytime with \`/link default\`.`,
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

  // Shared by /simulate and /map: both take typed mods and calculate on them. A
  // token dropped in silence here becomes a pp that looks like it answers the
  // question asked, but belongs to a different play.
  mods_bad:                (input) => `❌ I don't understand \`${input}\` in the mods. Use acronyms (\`HDDT\`), and add the rate to change speed: \`DT1.4\` (DT and NC from 1.01x to 2x, HT and DC from 0.5x to 0.99x).`,

  simulate_invalid_map:    "❌ Couldn't identify the map. Use the beatmap ID or a link (e.g. `https://osu.ppy.sh/beatmapsets/123#osu/456`).",
  simulate_map_not_found:  '❌ Map not found.',
  simulate_calc_error:     "❌ Couldn't calculate pp for this simulation. Check if the values make sense for the map.",
  simulate_error:          '❌ An error occurred while simulating the play.',
  simulate_title:          'PP Simulation',
  simulate_combo_fc:       'Full Combo',
  simulate_combo_assumed:  'max combo assumed',
  simulate_footer:         (label) => `Simulation • ${label}`,

  // ── /map ──────────────────────────────────────────────────────────────────
  // The pp table itself never comes through here: it's `95%` next to a pp
  // value, which reads the same in every language (same call the play embed
  // makes about labels).
  map_no_file:             "❌ Couldn't read this map's file, so there's no pp table to show.",
  map_footer:              (label, status, mapper) =>
    [status, mapper ? `mapset by ${mapper}` : null, label].filter(Boolean).join(' • '),
  map_error:               '❌ An error occurred while fetching this map.',

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

  pp_howmany_title:        (name, target) => `How many plays does ${name} need to reach ${target}pp?`,
  pp_target_unreachable:   (target) => `❌ **${target}pp** is too high to compute — not even an absurd play would get there. Try a lower target.`,
  pp_howmany_desc_progressive: (name, target, count, value, last, step) =>
    `To reach **${target}pp**, **${name}** would need approximately **${count}** play(s), ` +
    `starting at **${value}pp** and climbing **${step}pp** per play up to **${last}pp**.`,
  pp_howmany_desc_randomized: (name, target, count, value, last, step, min, max, pct) =>
    `To reach **${target}pp**, **${name}** would need approximately **${count}** play(s), ` +
    `climbing from **${value}pp** to around **${last}pp** (+${step}pp per play), ` +
    `with each play varying **±${pct}%** — the spread measured from their own top plays — ` +
    `which produced values between **${min}pp** and **${max}pp**.`,
  pp_howmany_impossible:   (name, value, cap) =>
    `❌ Even **${cap}** plays starting at **${value}pp** wouldn't get **${name}** to that target. ` +
    `Try a higher value per play.`,

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

  // ── Server administration (/nominate, /moderate) ──────────────────────────
  admin_not_configured:    '❌ Admin commands are not configured on this bot (missing `DAYCORE_GUILD_ID` in `.env`).',
  admin_wrong_guild:       `❌ This command only works in the ${ADMIN} Discord server.`,
  admin_not_staff:         `❌ You are not registered as ${ADMIN} staff. An administrator must register you with \`/staff register\`.`,
  admin_priv_fetch_failed: `❌ Could not read your ${ADMIN} privileges right now. Try again shortly.`,
  admin_missing_priv:      (role) => `❌ You do not have permission for this on ${ADMIN} (your role there: **${role}**).`,
  admin_redis_unconfigured:`❌ The ${ADMIN} connection is not configured (missing \`REDIS_HOST\` in \`.env\`). Without it the bot cannot apply changes to the server.`,
  admin_redis_unreachable: `❌ Could not reach ${ADMIN} right now (Redis unreachable). Nothing was changed.`,
  admin_action_failed:     '❌ An error occurred while performing the action. Nothing was confirmed — check the state before retrying.',
  admin_log_failed:        '⚠️ **Could not write this to the bot\'s audit log** — `/moderate log` will not show this action. What is above is the only record left: copy it before dismissing.',

  ann_title:               (status) => `Map is now ${status}`,
  ann_diffs:               (n) => `${n} difficulty(ies) on ${ADMIN}`,
  ann_by:                  (who) => `Applied by ${who}`,
  ann_by_ingame:           (who) => `Applied by ${who}, in-game`,
  ann_ingame_unknown:      'Applied in-game',

  // Log for roles changed INSIDE THE GAME. What goes through /role and the
  // admin panel is already embedded by the server's own audit webhook.
  priv_ann_title_give:     'Role granted in-game',
  priv_ann_title_take:     'Role removed in-game',
  priv_ann_roles:          (roles) => `Roles: **${roles}**`,
  priv_ann_by_ingame:      (who) => `Applied by ${who}, in-game`,
  priv_ann_ingame_unknown: 'Applied in-game',

  nom_invalid_map:         '❌ Could not identify that map. Use the beatmap/set ID or a link.',
  nom_map_not_found:       `❌ Map not found on ${ADMIN} or on osu!.`,
  nom_not_on_server:       `ℹ️ Not on ${ADMIN} yet — difficulties read from osu!, and the server fetches the map when the status is applied.`,
  nom_queue_not_cleared:   '⚠️ Could not empty this set\'s nomination queue — it still counts votes for a state that has already changed. Use `/nominate withdraw` if they get in the way.',
  nom_publish_interrupted: (published, total) => `⚠️ Publishing stopped at **${published}/${total}** difficulties (connection to ${ADMIN} failed). The ones already sent will still be applied — re-run to finish the rest.`,
  nom_set_line:            (setId, diffs) => `Set \`${setId}\` — ${diffs} difficulty(ies)`,
  nom_added_title:         (status) => `Nomination recorded (${status})`,
  nom_progress:            (have, need) => `**${have}/${need}** nominations.`,
  nom_by:                  (who) => `Nominated by: ${who}`,
  nom_threshold_reached:   (need) => `✅ Threshold of **${need}** nominations reached — applying on ${ADMIN}.`,
  nom_applied_title:       (status) => `Status applied: ${status}`,
  nom_all_confirmed:       (n) => `✅ Confirmed on **${n}** difficulty(ies).`,
  nom_none_confirmed:      (n) => `⚠️ Published for **${n}** difficulty(ies), but none confirmed yet. Bancho may still be processing — check again shortly.`,
  nom_partial:             (ok, total, ids) => `⚠️ Confirmed **${ok}/${total}**. Unconfirmed: \`${ids}\`.`,
  nom_withdrawn:           (label, left, need) => `✅ Nomination withdrawn from **${label}**. Now: **${left}/${need}**.`,
  nom_nothing_to_withdraw: (label) => `❌ You had no nomination on **${label}**.`,
  nom_queue_title:         '📋 Maps awaiting nomination',
  nom_queue_empty:         'No maps in the nomination queue.',
  nom_queue_line:          (setId, name, status, votes, need) =>
    `• \`${setId}\` **${name}** → ${status} (**${votes}/${need}**)`,
  nom_actor:               (name) => `Action by ${name}`,

  mod_check_title:         (name) => `${name}'s privileges`,
  mod_check_body:          (id, role, priv, state) =>
    `ID: \`${id}\`\nRole: **${role}**\n\`priv\`: \`${priv}\`\nState: ${state}`,
  mod_restricted:          '🔴 **Restricted**',
  mod_not_restricted:      '🟢 Not restricted',
  mod_cannot_self:         '❌ You cannot apply this to your own account.',
  mod_target_is_staff:     (name, role) => `❌ **${name}** is server staff (${role}), and only **Developer** can moderate staff members. Nothing was published.`,

  role_give_title:         (role) => `Role granted: ${role}`,
  role_take_title:         (role) => `Role removed: ${role}`,
  role_body:               (name, id, role, reason) =>
    `**${name}** (\`${id}\`)\nRole: **${role}**\nReason: ${reason}`,
  role_already_has:        (name, role) => `❌ **${name}** already has **${role}**.`,
  role_missing:            (name, role) => `❌ **${name}** does not have **${role}**.`,

  wipe_confirm_title:      '⚠️ Confirm score deletion',
  wipe_confirm_body:       (name, id, mode) => `Target: **${name}** (\`${id}\`)\nMode: **${mode}**`,
  wipe_stats_line:         (pp, plays, acc, combo, hits) => `Will be erased:\n• **${pp}pp**\n• **${plays}** plays\n• accuracy **${acc}%**\n• max combo **${combo}x**\n• **${hits}** total hits`,
  wipe_no_stats:           '⚠️ Could not read the current stats — I cannot tell you how much will be erased.',
  wipe_irreversible:       '**This cannot be undone.** Scores are deleted from the database and stats zeroed; not even the server owner can restore them.',
  wipe_button_confirm:     'Erase anyway',
  wipe_button_cancel:      'Cancel',
  wipe_cancelled:          '✅ Cancelled. Nothing was erased.',
  wipe_expired:            '⏲️ Confirmation expired. Nothing was erased.',
  wipe_done_title:         (mode) => `Scores erased (${mode})`,
  wipe_done_body:          (name, id, mode) => `**${name}** (\`${id}\`) — mode **${mode}**`,
  wipe_confirmed:          '✅ Confirmed: pp and plays are zero on the server.',
  wipe_unconfirmed:        '⚠️ Published, but the effect is not confirmed yet. Check the profile before retrying — repeating a wipe that already worked undoes nothing, but repeating it by mistake does not help either.',

  // ── /scorewipe ───────────────────────────────────────────────────────────────
  scorewipe_not_found:     (id) => `❌ No score \`${id}\` on the server.`,
  scorewipe_other_player:  (id, owner) => `❌ Score \`${id}\` belongs to another player (\`${owner}\`). Nothing was erased.`,
  scorewipe_other_mode:    (id, mode) => `❌ Score \`${id}\` is from **${mode}**. Run it again with that mode, or check the id.`,
  scorewipe_no_scores:     (name, mode) => `**${name}** has no plays on **${mode}** to list.`,
  scorewipe_pick_title:    'Pick the score',
  scorewipe_pick_body:     (name, id, mode) => `Target: **${name}** (\`${id}\`)\nMode: **${mode}**`,
  scorewipe_pick_placeholder: 'Which play to erase',
  scorewipe_map_unknown:   'unknown map',
  scorewipe_score_line:    (map, pp, acc, mods, grade, when) => `**${map}**\n• **${pp}pp** ${mods}\n• **${grade}** · accuracy **${acc}%**\n• played on ${when}`,
  scorewipe_already:       (id) => `Score \`${id}\` is already erased. Nothing was published.`,
  scorewipe_confirm_title: '⚠️ Confirm score deletion',
  scorewipe_confirm_body:  (name, id, mode) => `Target: **${name}** (\`${id}\`)\nMode: **${mode}**`,
  scorewipe_was_best:      '⚠️ This is their best score on the map: the runner-up takes the slot, and their pp drops only by the difference between the two.',
  scorewipe_reversible:    'The score leaves the leaderboards, the top plays and the pp total. The row stays in the database (status `-1`), so it can be undone — but only in the database itself: the bot has no command for that.',
  scorewipe_button_confirm: 'Erase this score',
  scorewipe_cancelled:     '✅ Cancelled. Nothing was erased.',
  scorewipe_expired:       '⏲️ Confirmation expired. Nothing was erased.',
  scorewipe_done_title:    'Score erased',
  scorewipe_done_body:     (name, id, scoreId) => `**${name}** (\`${id}\`) — score \`${scoreId}\``,
  scorewipe_confirmed:     '✅ Confirmed: the server marked the score as erased.',
  scorewipe_unconfirmed:   '⚠️ Published, but the effect is not confirmed yet. Check the profile before retrying.',
  mod_already_restricted:  (name) => `❌ **${name}** is already restricted.`,
  mod_not_currently_restricted: (name) => `❌ **${name}** is not restricted.`,
  mod_restrict_title:      'Player restricted',
  mod_unrestrict_title:    'Restriction lifted',
  mod_action_body:         (name, id, reason) => `**${name}** (\`${id}\`)\nReason: ${reason}`,
  mod_confirmed:           `✅ Confirmed on ${ADMIN}.`,
  mod_unconfirmed:         '⚠️ The request was published, but the effect could not be confirmed. Verify with `/moderate check`.',
  mod_log_title:           '📜 Recent actions via bot',
  mod_log_empty:           'No actions recorded yet.',
  mod_log_line:            (when, action, target, actor, detail) =>
    `\`${when}\` **${action}** \`${target}\` — ${actor}${detail ? ` (${detail})` : ''}`,

  staff_need_admin:        '❌ You need **Administrator** permission in this Discord to manage staff links.',
  staff_list_title:        `🔑 ${ADMIN} staff links`,
  staff_list_empty:        'No staff links registered. Use `/staff register`.',
  staff_list_line:         (discordId, osuName, osuId) => `• <@${discordId}> → **${osuName}** (\`${osuId}\`)`,
  staff_list_duplicate:    '⚠️ duplicate account',
  staff_proof_self:        '`proven`',
  staff_proof_vouch:       '`vouched`',
  staff_proof_legacy:      '`legacy`',
  staff_proof_legend:      '-# `proven` = the person proved they own the account and can vouch for others (if Developer). `vouched` = created by a proven Developer. `legacy` = predates the proof; still valid, but vouches for no one.',
  staff_vouched_note:      (voucher) => `Linked without a code: vouched for by **${voucher}**, who is a Developer and has proven their own account.`,
  staff_osu_already_linked:(discordId, osuName, osuId) => `❌ The account **${osuName}** (\`${osuId}\`) is already linked to <@${discordId}>. Run \`/staff remove\` on that member first — two Discord accounts on one game account leave the server's audit log unable to tell who acted.`,
  staff_challenge_title:   '🔑 Waiting for them to confirm',
  staff_challenge_body:    (discordId, osuName, osuId, role, code, minutes) =>
    `Link requested: <@${discordId}> → **${osuName}** (\`${osuId}\`, ${role})\n\n` +
    `**Nothing has been linked yet.** To finish, <@${discordId}> must:\n` +
    `1. Sign in to **${osuName}** on the server's site and put this code in their profile ("about me"):\n` +
    `\`\`\`\n${code}\n\`\`\`\n` +
    `2. Run \`/staff confirm\` here.\n\n` +
    `The code is valid for **${minutes} minutes**. Only someone signed in to that account can edit its profile — that is what proves the account is theirs.`,
  staff_link_unchanged:    (discordId, osuName, osuId, role) =>
    `ℹ️ <@${discordId}> is already linked to **${osuName}** (\`${osuId}\`, ${role}). Nothing changed, and there is nothing to confirm again.\n\nTo require proof of ownership once more, run \`/staff remove\` on that member first.`,
  staff_no_challenge:      '❌ You have no pending link. Ask an administrator to run `/staff register` with your account first.',
  staff_code_not_found:    (osuName, code) =>
    `❌ I could not find the code on **${osuName}**'s profile.\n\nPut \`${code}\` in the profile's "about me" field, save it, then run \`/staff confirm\` again. If you just saved, give it a few seconds.`,
  staff_code_can_be_removed: 'You can remove the code from your profile now.',
  staff_registered_title:  '✅ Staff link registered',
  staff_registered_body:   (discordId, osuName, osuId, role) =>
    `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Current ${ADMIN} role: **${role}**

` +
    `The link alone grants nothing: permission comes from the ${ADMIN} role, checked on every command.`,
  staff_removed:           (discordId) => `✅ Link for <@${discordId}> removed.`,
  staff_nothing_to_remove: (discordId) => `❌ <@${discordId}> had no staff link.`,
  // ── /diag: diagnostics ───────────────────────────────────────────────────
  // Cache and bucket names are code identifiers and stay as they are in all
  // three languages: translating them would make the output impossible to
  // match against what the modules actually say.
  diag_title:             '📊 Bot diagnostics',
  diag_uptime:            (texto) => `Up for **${texto}**`,
  diag_caches:            'Caches (hits / total)',
  diag_limiter:           'Rate limiter (calls, accumulated wait)',
  diag_workers:           'PP engines',
  diag_worker_line:       (nome, vivo, servidos, falhas) =>
    `**${nome}**: ${vivo ? 'up' : 'down'} — ${servidos} calculation(s), ${falhas} failure(s)`,
  diag_empty:             '_Nothing recorded yet — the bot just started._',
});

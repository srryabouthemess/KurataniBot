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
  help_cmd_whatif:         'How much PP a new play would earn you.',
  help_cmd_pp:             'What you still need to reach a PP total.',
  help_cmd_simulate:       'How much PP a specific play on a map would be worth.',
  help_cmd_link:           'Link your osu! account to Discord.',
  help_cmd_language:       'Change the language: Português, English or Русский.',
  help_cmd_nominate:       'Nominate maps to change their status.',
  help_cmd_moderate:       'Inspect and restrict accounts.',
  help_cmd_staff:          'Manage staff links.',
  help_servers:            '🌐 Available servers',
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
  recent_footer:           (mode, date, label, page, total, status) =>
    `Play ${page}/${total} • Mode: ${mode}${status ? ` • ${status}` : ''} • ${label} • ${date}`,

  score_no_map:            '❌ Provide a map (ID or link) — I found no recent map in this channel.',
  score_none:              (name, map, label) => `**${name}** has no scores on **${map}** in ${label}.`,
  score_no_mods:           'No Mods',
  score_footer:            (page, total, count, label, status) =>
    `Page ${page}/${total} • ${count} score(s)${status ? ` • ${status}` : ''} • ${label}`,
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
  admin_redis_unreachable: (err) => `❌ Could not reach ${ADMIN} right now (Redis unreachable${err ? `: ${err}` : ''}). Nothing was changed.`,
  admin_action_failed:     '❌ An error occurred while performing the action. Nothing was confirmed — check the state before retrying.',

  nom_invalid_map:         '❌ Could not identify that map. Use the beatmap/set ID or a link.',
  nom_map_not_found:       `❌ Map not found on ${ADMIN}.`,
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
  staff_registered_title:  '✅ Staff link registered',
  staff_registered_body:   (discordId, osuName, osuId, role) =>
    `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Current ${ADMIN} role: **${role}**

` +
    `The link alone grants nothing: permission comes from the ${ADMIN} role, checked on every command.`,
  staff_removed:           (discordId) => `✅ Link for <@${discordId}> removed.`,
  staff_nothing_to_remove: (discordId) => `❌ <@${discordId}> had no staff link.`,
});

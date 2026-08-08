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

    pp_howmany_title:        (name, target) => `Quantas plays ${name} precisa para chegar a ${target}pp?`,
    pp_howmany_desc_progressive: (name, target, count, value, last, step) =>
      `Para chegar aos **${target}pp**, **${name}** precisaria de aproximadamente **${count}** play(s), ` +
      `começando em **${value}pp** e subindo **${step}pp** por play até **${last}pp**.`,
    pp_howmany_desc_randomized: (name, target, count, value, last, step, min, max, pct) =>
      `Para chegar aos **${target}pp**, **${name}** precisaria de aproximadamente **${count}** play(s), ` +
      `subindo de **${value}pp** até cerca de **${last}pp** (+${step}pp por play), ` +
      `com cada play variando **±${pct}%** — a dispersão medida nas top plays dele(a) — ` +
      `o que deu valores entre **${min}pp** e **${max}pp**.`,
    pp_howmany_impossible:   (name, value, cap) =>
      `❌ Nem com **${cap}** plays começando em **${value}pp** o **${name}** chega nessa meta. ` +
      `Tente um valor por play mais alto.`,

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

    // ── Administração do Daycore (/nominate, /moderate) ───────────────────────
    admin_not_configured:    '❌ Os comandos administrativos não estão configurados neste bot (falta `DAYCORE_GUILD_ID` no `.env`).',
    admin_wrong_guild:       '❌ Este comando só funciona no servidor Discord do Daycore.',
    admin_not_staff:         '❌ Você não está registrado como staff do Daycore. Um administrador precisa te registrar com `/staff register`.',
    admin_priv_fetch_failed: '❌ Não consegui consultar seus privilégios no Daycore agora. Tente de novo em instantes.',
    admin_missing_priv:      (role) => `❌ Você não tem permissão para isso no Daycore (seu cargo lá: **${role}**).`,
    admin_redis_unconfigured:'❌ A conexão com o Daycore não está configurada (falta `REDIS_HOST` no `.env`). Sem ela o bot não consegue aplicar mudanças no servidor.',
    admin_redis_unreachable: (err) => `❌ Não consegui falar com o Daycore agora (Redis inacessível${err ? `: ${err}` : ''}). Nada foi alterado.`,
    admin_action_failed:     '❌ Ocorreu um erro ao executar a ação. Nada foi confirmado — verifique o estado antes de tentar de novo.',

    nom_invalid_map:         '❌ Não entendi qual mapa é esse. Use o ID do beatmap/set ou um link.',
    nom_map_not_found:       '❌ Mapa não encontrado no Daycore.',
    nom_set_line:            (setId, diffs) => `Set \`${setId}\` — ${diffs} dificuldade(s)`,
    nom_added_title:         (status) => `Nomeação registrada (${status})`,
    nom_progress:            (have, need) => `**${have}/${need}** nomeações.`,
    nom_by:                  (who) => `Nomeado por: ${who}`,
    nom_threshold_reached:   (need) => `✅ Limiar de **${need}** nomeações atingido — aplicando no Daycore.`,
    nom_applied_title:       (status) => `Status aplicado: ${status}`,
    nom_all_confirmed:       (n) => `✅ Confirmado em **${n}** dificuldade(s).`,
    nom_none_confirmed:      (n) => `⚠️ Publiquei para **${n}** dificuldade(s), mas nenhuma confirmou ainda. O bancho pode estar processando — confira daqui a pouco.`,
    nom_partial:             (ok, total, ids) => `⚠️ Confirmadas **${ok}/${total}**. Sem confirmação: \`${ids}\`.`,
    nom_withdrawn:           (label, left, need) => `✅ Nomeação retirada de **${label}**. Agora: **${left}/${need}**.`,
    nom_nothing_to_withdraw: (label) => `❌ Você não tinha nomeação registrada em **${label}**.`,
    nom_queue_title:         '📋 Mapas aguardando nomeação',
    nom_queue_empty:         'Nenhum mapa na fila de nomeação.',
    nom_queue_line:          (setId, name, status, votes, need) =>
      `• \`${setId}\` **${name}** → ${status} (**${votes}/${need}**)`,
    nom_actor:               (name) => `Ação de ${name}`,

    mod_check_title:         (name) => `Privilégios de ${name}`,
    mod_check_body:          (id, role, priv, state) =>
      `ID: \`${id}\`\nCargo: **${role}**\n\`priv\`: \`${priv}\`\nEstado: ${state}`,
    mod_restricted:          '🔴 **Restrito**',
    mod_not_restricted:      '🟢 Sem restrição',
    mod_cannot_self:         '❌ Você não pode aplicar isso na sua própria conta.',
    mod_already_restricted:  (name) => `❌ **${name}** já está restrito.`,
    mod_not_currently_restricted: (name) => `❌ **${name}** não está restrito.`,
    mod_restrict_title:      'Jogador restrito',
    mod_unrestrict_title:    'Restrição removida',
    mod_action_body:         (name, id, reason) => `**${name}** (\`${id}\`)\nMotivo: ${reason}`,
    mod_confirmed:           '✅ Confirmado no Daycore.',
    mod_unconfirmed:         '⚠️ Publiquei o pedido, mas não consegui confirmar o efeito. Verifique com `/moderate check`.',
    mod_log_title:           '📜 Ações recentes via bot',
    mod_log_empty:           'Nenhuma ação registrada ainda.',
    mod_log_line:            (when, action, target, actor, detail) =>
      `\`${when}\` **${action}** \`${target}\` — ${actor}${detail ? ` (${detail})` : ''}`,

    staff_need_admin:        '❌ Você precisa da permissão de **Administrador** neste Discord para gerenciar vínculos de staff.',
    staff_list_title:        '🔑 Vínculos de staff do Daycore',
    staff_list_empty:        'Nenhum vínculo de staff registrado. Use `/staff register`.',
    staff_list_line:         (discordId, osuName, osuId) => `• <@${discordId}> → **${osuName}** (\`${osuId}\`)`,
    staff_registered_title:  '✅ Vínculo de staff registrado',
    staff_registered_body:   (discordId, osuName, osuId, role) =>
      `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Cargo atual no Daycore: **${role}**

` +
      `O vínculo em si não concede poder: a permissão vem do cargo no Daycore, conferido a cada comando.`,
    staff_removed:           (discordId) => `✅ Vínculo de <@${discordId}> removido.`,
    staff_nothing_to_remove: (discordId) => `❌ <@${discordId}> não tinha vínculo de staff.`,
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

    // ── Daycore administration (/nominate, /moderate) ─────────────────────────
    admin_not_configured:    '❌ Admin commands are not configured on this bot (missing `DAYCORE_GUILD_ID` in `.env`).',
    admin_wrong_guild:       '❌ This command only works in the Daycore Discord server.',
    admin_not_staff:         '❌ You are not registered as Daycore staff. An administrator must register you with `/staff register`.',
    admin_priv_fetch_failed: '❌ Could not read your Daycore privileges right now. Try again shortly.',
    admin_missing_priv:      (role) => `❌ You do not have permission for this on Daycore (your role there: **${role}**).`,
    admin_redis_unconfigured:'❌ The Daycore connection is not configured (missing `REDIS_HOST` in `.env`). Without it the bot cannot apply changes to the server.',
    admin_redis_unreachable: (err) => `❌ Could not reach Daycore right now (Redis unreachable${err ? `: ${err}` : ''}). Nothing was changed.`,
    admin_action_failed:     '❌ An error occurred while performing the action. Nothing was confirmed — check the state before retrying.',

    nom_invalid_map:         '❌ Could not identify that map. Use the beatmap/set ID or a link.',
    nom_map_not_found:       '❌ Map not found on Daycore.',
    nom_set_line:            (setId, diffs) => `Set \`${setId}\` — ${diffs} difficulty(ies)`,
    nom_added_title:         (status) => `Nomination recorded (${status})`,
    nom_progress:            (have, need) => `**${have}/${need}** nominations.`,
    nom_by:                  (who) => `Nominated by: ${who}`,
    nom_threshold_reached:   (need) => `✅ Threshold of **${need}** nominations reached — applying on Daycore.`,
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
    mod_confirmed:           '✅ Confirmed on Daycore.',
    mod_unconfirmed:         '⚠️ The request was published, but the effect could not be confirmed. Verify with `/moderate check`.',
    mod_log_title:           '📜 Recent actions via bot',
    mod_log_empty:           'No actions recorded yet.',
    mod_log_line:            (when, action, target, actor, detail) =>
      `\`${when}\` **${action}** \`${target}\` — ${actor}${detail ? ` (${detail})` : ''}`,

    staff_need_admin:        '❌ You need **Administrator** permission in this Discord to manage staff links.',
    staff_list_title:        '🔑 Daycore staff links',
    staff_list_empty:        'No staff links registered. Use `/staff register`.',
    staff_list_line:         (discordId, osuName, osuId) => `• <@${discordId}> → **${osuName}** (\`${osuId}\`)`,
    staff_registered_title:  '✅ Staff link registered',
    staff_registered_body:   (discordId, osuName, osuId, role) =>
      `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Current Daycore role: **${role}**

` +
      `The link alone grants nothing: permission comes from the Daycore role, checked on every command.`,
    staff_removed:           (discordId) => `✅ Link for <@${discordId}> removed.`,
    staff_nothing_to_remove: (discordId) => `❌ <@${discordId}> had no staff link.`,
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

    // ── Администрирование Daycore (/nominate, /moderate) ──────────────────────
    admin_not_configured:    '❌ Административные команды не настроены на этом боте (отсутствует `DAYCORE_GUILD_ID` в `.env`).',
    admin_wrong_guild:       '❌ Эта команда работает только на Discord-сервере Daycore.',
    admin_not_staff:         '❌ Вы не зарегистрированы как персонал Daycore. Администратор должен добавить вас через `/staff register`.',
    admin_priv_fetch_failed: '❌ Сейчас не удалось получить ваши привилегии на Daycore. Попробуйте позже.',
    admin_missing_priv:      (role) => `❌ У вас нет прав для этого на Daycore (ваша роль там: **${role}**).`,
    admin_redis_unconfigured:'❌ Подключение к Daycore не настроено (отсутствует `REDIS_HOST` в `.env`). Без него бот не может применять изменения на сервере.',
    admin_redis_unreachable: (err) => `❌ Сейчас нет связи с Daycore (Redis недоступен${err ? `: ${err}` : ''}). Ничего не изменено.`,
    admin_action_failed:     '❌ Произошла ошибка при выполнении действия. Ничего не подтверждено — проверьте состояние перед повтором.',

    nom_invalid_map:         '❌ Не удалось определить карту. Укажите ID карты/сета или ссылку.',
    nom_map_not_found:       '❌ Карта не найдена на Daycore.',
    nom_set_line:            (setId, diffs) => `Сет \`${setId}\` — сложностей: ${diffs}`,
    nom_added_title:         (status) => `Номинация записана (${status})`,
    nom_progress:            (have, need) => `**${have}/${need}** номинаций.`,
    nom_by:                  (who) => `Номинировали: ${who}`,
    nom_threshold_reached:   (need) => `✅ Порог в **${need}** номинаций достигнут — применяю на Daycore.`,
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
    mod_confirmed:           '✅ Подтверждено на Daycore.',
    mod_unconfirmed:         '⚠️ Запрос опубликован, но подтвердить эффект не удалось. Проверьте через `/moderate check`.',
    mod_log_title:           '📜 Недавние действия через бота',
    mod_log_empty:           'Действий пока не записано.',
    mod_log_line:            (when, action, target, actor, detail) =>
      `\`${when}\` **${action}** \`${target}\` — ${actor}${detail ? ` (${detail})` : ''}`,

    staff_need_admin:        '❌ Для управления привязками персонала нужны права **Администратора** в этом Discord.',
    staff_list_title:        '🔑 Привязки персонала Daycore',
    staff_list_empty:        'Привязок персонала нет. Используйте `/staff register`.',
    staff_list_line:         (discordId, osuName, osuId) => `• <@${discordId}> → **${osuName}** (\`${osuId}\`)`,
    staff_registered_title:  '✅ Привязка персонала создана',
    staff_registered_body:   (discordId, osuName, osuId, role) =>
      `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Текущая роль на Daycore: **${role}**

` +
      `Сама привязка ничего не даёт: права берутся из роли на Daycore и проверяются при каждой команде.`,
    staff_removed:           (discordId) => `✅ Привязка <@${discordId}> удалена.`,
    staff_nothing_to_remove: (discordId) => `❌ У <@${discordId}> не было привязки персонала.`,
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

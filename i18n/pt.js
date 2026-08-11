/**
 * i18n/pt.js
 * Strings em Português (BR).
 *
 * Recebe `ADMIN`, o rótulo do servidor que os comandos administrativos
 * operam — ele vem da configuração, para as mensagens não dizerem o nome de um
 * servidor específico num bot hospedado para outro.
 */

module.exports = ({ ADMIN }) => ({
  // Locale para formatação de números (ex: 10.000 vs 10,000)
  locale:                  'pt-BR',

  player_not_found:        '❌ Jogador não encontrado.',
  error_generic:           '❌ Ocorreu um erro ao buscar os dados.',
  no_link_set:             '❌ Você não tem um link definido. Use `/link set` ou informe o nome do jogador.',
  cooldown_wait:           (secs) => `⏳ Calma aí! Tente de novo em **${secs}s**.`,

  // ── Comandos por texto (prefixo) ──────────────────────────────────────────
  // Só aparecem no modo `k!comando`: no slash o próprio Discord valida antes
  // de a interação chegar aqui.
  prefix_usage:            (usage) => `❌ Uso: \`${usage}\``,
  prefix_missing_option:   (name, usage) => `❌ Faltou informar \`${name}\`.\n-# Uso: \`${usage}\``,
  prefix_extra_args:       (usage) => `❌ Argumentos demais. Se o nome tem espaço, use aspas: \`"nome com espaço"\`.\n-# Uso: \`${usage}\``,
  prefix_invalid_choice:   (name, accepted) => `❌ Valor inválido para \`${name}\`. Aceita: ${accepted}.`,
  prefix_unknown_flag:     (flag, accepted) => `❌ Não conheço a flag \`${flag}\`. Nesse comando dá para usar: ${accepted}.`,
  prefix_no_flags:         (flag, usage) => `❌ Esse comando não tem flags como \`${flag}\`.\n-# Uso: \`${usage}\``,
  prefix_invalid_integer:  (name) => `❌ \`${name}\` precisa ser um número inteiro.`,
  prefix_invalid_number:   (name) => `❌ \`${name}\` precisa ser um número.`,
  prefix_out_of_range:     (name, range) => `❌ \`${name}\` está fora do limite (${range}).`,
  prefix_too_long:         (name, max) => `❌ \`${name}\` passou de ${max} caracteres.`,
  prefix_too_short:        (name, min) => `❌ \`${name}\` precisa ter pelo menos ${min} caracteres.`,
  prefix_invalid_boolean:  (name) => `❌ \`${name}\` aceita só sim/não.`,
  prefix_user_not_found:   (name) => `❌ Não achei o usuário em \`${name}\` — mencione a pessoa (@fulano) ou passe o ID.`,
  prefix_guild_only:       '❌ Esse comando só funciona dentro de um servidor.',
  prefix_no_permission:    '❌ Você não tem permissão para usar esse comando.',

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

  // O /score reaproveita simulate_invalid_map e simulate_map_not_found: a
  // orientação sobre ID/link do mapa é a mesma dos dois comandos.
  score_no_map:            '❌ Informe um mapa (ID ou link) — não achei nenhum mapa recente neste canal.',
  score_none:              (name, map, label) => `**${name}** não tem nenhum score em **${map}** no ${label}.`,
  score_no_mods:           'No Mods',
  score_footer:            (page, total, count, label) => `Página ${page}/${total} • ${count} score(s) • ${label}`,
  score_error:             'Erro ao buscar os scores desse mapa.',

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
  pp_target_unreachable:   (target) => `❌ **${target}pp** é alto demais para calcular — nem uma play absurda chegaria lá. Tente um alvo menor.`,
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

  // ── Administração do servidor (/nominate, /moderate) ──────────────────────
  admin_not_configured:    '❌ Os comandos administrativos não estão configurados neste bot (falta `DAYCORE_GUILD_ID` no `.env`).',
  admin_wrong_guild:       `❌ Este comando só funciona no servidor Discord do ${ADMIN}.`,
  admin_not_staff:         `❌ Você não está registrado como staff do ${ADMIN}. Um administrador precisa te registrar com \`/staff register\`.`,
  admin_priv_fetch_failed: `❌ Não consegui consultar seus privilégios no ${ADMIN} agora. Tente de novo em instantes.`,
  admin_missing_priv:      (role) => `❌ Você não tem permissão para isso no ${ADMIN} (seu cargo lá: **${role}**).`,
  admin_redis_unconfigured:`❌ A conexão com o ${ADMIN} não está configurada (falta \`REDIS_HOST\` no \`.env\`). Sem ela o bot não consegue aplicar mudanças no servidor.`,
  admin_redis_unreachable: (err) => `❌ Não consegui falar com o ${ADMIN} agora (Redis inacessível${err ? `: ${err}` : ''}). Nada foi alterado.`,
  admin_action_failed:     '❌ Ocorreu um erro ao executar a ação. Nada foi confirmado — verifique o estado antes de tentar de novo.',

  nom_invalid_map:         '❌ Não entendi qual mapa é esse. Use o ID do beatmap/set ou um link.',
  nom_map_not_found:       `❌ Mapa não encontrado no ${ADMIN}.`,
  nom_set_line:            (setId, diffs) => `Set \`${setId}\` — ${diffs} dificuldade(s)`,
  nom_added_title:         (status) => `Nomeação registrada (${status})`,
  nom_progress:            (have, need) => `**${have}/${need}** nomeações.`,
  nom_by:                  (who) => `Nomeado por: ${who}`,
  nom_threshold_reached:   (need) => `✅ Limiar de **${need}** nomeações atingido — aplicando no ${ADMIN}.`,
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
  mod_confirmed:           `✅ Confirmado no ${ADMIN}.`,
  mod_unconfirmed:         '⚠️ Publiquei o pedido, mas não consegui confirmar o efeito. Verifique com `/moderate check`.',
  mod_log_title:           '📜 Ações recentes via bot',
  mod_log_empty:           'Nenhuma ação registrada ainda.',
  mod_log_line:            (when, action, target, actor, detail) =>
    `\`${when}\` **${action}** \`${target}\` — ${actor}${detail ? ` (${detail})` : ''}`,

  staff_need_admin:        '❌ Você precisa da permissão de **Administrador** neste Discord para gerenciar vínculos de staff.',
  staff_list_title:        `🔑 Vínculos de staff do ${ADMIN}`,
  staff_list_empty:        'Nenhum vínculo de staff registrado. Use `/staff register`.',
  staff_list_line:         (discordId, osuName, osuId) => `• <@${discordId}> → **${osuName}** (\`${osuId}\`)`,
  staff_registered_title:  '✅ Vínculo de staff registrado',
  staff_registered_body:   (discordId, osuName, osuId, role) =>
    `<@${discordId}> → **${osuName}** (\`${osuId}\`)
Cargo atual no ${ADMIN}: **${role}**

` +
    `O vínculo em si não concede poder: a permissão vem do cargo no ${ADMIN}, conferido a cada comando.`,
  staff_removed:           (discordId) => `✅ Vínculo de <@${discordId}> removido.`,
  staff_nothing_to_remove: (discordId) => `❌ <@${discordId}> não tinha vínculo de staff.`,
});

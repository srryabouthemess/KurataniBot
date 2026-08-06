# Changelog — KurataniBot

Registro técnico das mudanças feitas na sessão de 2026-08-05.

## ✨ Novos recursos

- **`/simulate`** — simula o PP de uma play hipotética num mapa específico, dado `map` (ID/link), `mods`, `n100`, `n50`, `miss` e `combo` (opcional, default FC). Funciona nos três servidores (Bancho, Daycore, Daycore RX).
  - [`commands/simulate.js`](commands/simulate.js)
  - Novo em `osuClient.js`: `simulatePP()`, `parseBeatmapId()`, `parseModsString()`, `modsToBits()`, `getBeatmap()` (export do `fetchBeatmap` já existente).
  - `pp_calc.py` ganhou um segundo modo de cálculo ("simulação": misses contam como misses reais e `n300` é auto-completado pela lib) além do modo FC original ("misses mesclados ao n300").

- **Bot instalável em DM/grupos entre usuários** (não só em servidores) — todos os 9 comandos agora declaram `integration_types: [GuildInstall, UserInstall]` e `contexts: [Guild, BotDM, PrivateChannel]`.
  - Requer habilitar **"User Install"** em *Installation* no Discord Developer Portal (passo manual, fora do código) — sem isso a mudança de código sozinha não tem efeito.
  - Cada usuário que quiser usar em DM precisa clicar "Add App" no perfil do bot (instala na conta pessoal, não no servidor).

## 🐛 Correções de bugs

- **PP incorreto no Daycore vanilla e Bancho** — `rosu-pp-js` calculava por padrão com a mecânica de sliders do **osu!lazer** (`lazer: true`), mas:
  - Daycore vanilla roda client stable clássico → agora sempre `lazer: false`.
  - Bancho agora detecta o mod **CL (Classic)** no score e só usa `lazer: false` quando ele está presente, em vez de presumir lazer sempre. Nova função `shouldUseLazer(mode, mods)` em `osuClient.js`, aplicada em `getFCpp()` e `simulatePP()`.
  - `parseModsString()` reconhece `CL` como token válido (não entra no bitmask numérico, só afeta a flag de lazer).

- **`/whatif` calculava a posição errada em caso de empate exato de PP** — `simulateWhatIf()` usava `findIndex(p => p.pp === hypotheticalPP)`, que podia pegar uma play real em vez da hipotética (sort estável + empate). Trocado por `indexOf()` com referência de objeto. [`commands/whatif.js`](commands/whatif.js)

- **RX podia falhar silenciosamente em servidor Linux** — `calcPPPython` chamava `spawn('python', ...)`, mas a maioria das distros só tem `python3` no PATH. Agora detecta a plataforma (`python` no Windows, `python3` em Linux/macOS) e loga erro se o spawn falhar. Variável `PYTHON_BIN` no `.env` permite sobrescrever.

- **Bot podia crashar inteiro em interações expiradas** — o catch global do `index.js` fazia `interaction.reply()` sem checar se a interação já tinha sido respondida/deferida por dentro do comando; se falhasse, virava uma unhandled promise rejection e derrubava o processo (padrão do Node desde a v15). Agora checa `interaction.deferred || interaction.replied` (usa `followUp` nesse caso) e tem `.catch(() => {})` como rede de segurança.

- `resolvePlayerId()` tratava uma string só de espaços como ID `0` (`isNaN('   ')` é `false`). Trocado por regex `/^\d+$/`.

## 🔒 Segurança

- **Vazamento de token em log** — `console.error(error)` em cima de um `AxiosError` sem `.response` (falha de rede) imprimia o objeto inteiro, incluindo `.config.headers.Authorization` (o Bearer token da API oficial do osu!). Criado [`logger.js`](logger.js) com `logError()`, que só loga `message`/`status`/`data` — nunca o `config`. Aplicado nos 8 pontos que logavam o erro cru (`index.js` + 7 comandos).

## 🗄️ Infraestrutura

- **Migração de JSON para SQLite** (`node:sqlite`, nativo do Node ≥22.5, zero dependência nova):
  - [`db.js`](db.js) reescrito — tabela `users` (link osu! + idioma juntos) e `guild_settings` (idioma do servidor), em `bot.db`.
  - Migração automática e idempotente dos dados antigos (`links.json`/`languages.json` → `bot.db`, arquivos originais renomeados para `.migrated` como backup).
  - Antes disso, `db.js` tinha funções de idioma **mortas** (nunca chamadas — `/language` usava uma implementação paralela dentro do `i18n.js`, escrevendo num `langs.json` que nem existia). Consolidado numa fonte única de verdade.
  - `i18n.js` não persiste mais nada — só resolve strings e delega ao `db.js`.
  - `package.json` ganhou `"engines": {"node": ">=22.13.0"}`; `db.js` agora falha com mensagem clara (em vez de stack trace críptico) se rodar em Node incompatível.
  - ⚠️ O mínimo é **22.13**, não 22.5: o `node:sqlite` foi adicionado na v22.5.0 mas exigia a flag `--experimental-sqlite` até a v22.13/v23.4 ([docs](https://nodejs.org/api/sqlite.html)). Em 22.5–22.12 o bot crasharia no boot.

- `index.js` não registra mais os slash commands a cada boot (fazia isso redundantemente com `deploy-commands.js`) — agora só carrega os handlers; registro fica exclusivamente no `deploy-commands.js`.

## 🧹 Limpeza / estilo

- Removido `osuAuth.js` (código morto, não usado em lugar nenhum).
- `.env.example` limpo — removidas `GUILD_ID`, `PRIVATE_SERVER_URL`, `PRIVATE_API_KEY` (nunca lidas por nenhum código); adicionada `PYTHON_BIN`.
- `commands/wi.js` não duplica mais as opções do `whatif.js` — deriva de `whatif.data.toJSON()`.
- `README.md` atualizado: requisito de Node (v18+ → v22.5+), `/simulate` na tabela de comandos, árvore do projeto, variáveis de ambiente.

## Arquivos novos
`commands/simulate.js`, `logger.js`, `CHANGELOG.md`

## Arquivos removidos
`osuAuth.js`, `links.json` (→ `links.json.migrated`), `languages.json` (→ `languages.json.migrated`)

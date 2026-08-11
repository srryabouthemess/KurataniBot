# Changelog — KurataniBot

---

# Sessão de 2026-08-11

## ⚡ Desempenho

- **Índice na evicção do cache de mapas.** [`db.js`](src/db.js)
  - A evicção roda a cada download novo e ordenava por "usado menos recentemente" sem índice — uma varredura da tabela inteira, que é onde os BLOBs moram. Medido com o cache cheio (1500 mapas, 87MB de banco): **41ms de event loop parado por mapa novo, contra 0,07ms com o índice**. Como só dispara depois que o cache enche, era um custo permanente e invisível.
  - Medidos e descartados no caminho: o `COUNT(*)` que roda junto (0,04ms), a leitura síncrona de um blob de 60KB (0,05ms) e o pior caso do `/pp` (20ms, com 5000 plays simuladas; caso realista, 1ms). Nenhum justifica mudança.

- **Prefetch da página seguinte na paginação.** [`pagination.js`](src/pagination.js)
  - O gargalo de uma página nova não é CPU: é o balde de download de `.osu` (2/s, o mais apertado do rate limiter). Uma página de `/topplays` com 5 mapas inéditos passa ~2,5s só na fila. Agora, assim que uma página é exibida, os arquivos da próxima começam a ser baixados — sem `await`, então uma falha só faz o clique seguir o caminho normal.

## 🧱 Organização

- **Um adaptador por tipo de servidor.** [`osu/officialApi.js`](src/osu/officialApi.js), [`osu/banchoPyApi.js`](src/osu/banchoPyApi.js)
  - Seis funções do `osuClient` decidiam por `if (servers.isOfficial(mode))`. Cada tipo novo de servidor obrigaria a editar todas — o oposto de aberto para extensão. Agora os dois adaptadores implementam o mesmo contrato (`fetchUser`, `bestScores`, `recentScores`, `beatmapScores`, `userUrl`, `mapUrl`) e a escolha acontece num lugar só, no `apiFor(mode)`, pelo `kind` que já vinha do registro.
  - Tipo sem adaptador **falha alto** em vez de cair no oficial em silêncio e devolver o perfil errado.
  - Os comandos também paravam para pensar em servidor: `isOfficial(mode) ? página : await enrichScores(página)` aparecia em três arquivos. O `enrichScores` do cliente passou a resolver isso sozinho (no oficial é um no-op), e os comandos só pedem.
  - `osuClient.js`: 951 → **370 linhas**, agora só despacho e o que é comum aos dois (metadados de mapa, cache de usuário, links).

- **`prefixCommands.js` dividido por responsabilidade.** [`prefix/`](src/prefix/)
  - Eram 534 linhas fazendo cinco coisas: configuração, leitura da linha digitada, entendimento das opções, imitação da interação e despacho. Viraram `config`, `tokenize`, `spec`, `coerce`, `parseArgs` e `MessageCommand`, com o `prefixCommands.js` reduzido a 150 linhas de ponta (travas de acesso e despacho).
  - O ganho prático: o parser virou lógica pura, testável sem nada do Discord por perto, e o `tokenize` não depende de mais nada.

- **Cache de mapas saiu do `bot.db` para um `cache.db` anexado.** [`db.js`](src/db.js)
  - Os dados que importam somam dezenas de KB; o cache de `.osu` chega a ~90MB. Junto num arquivo só, todo backup ou cópia carregava dezenas de MB de coisa regenerável, e não dava para apagar o cache sem arriscar o resto. Medido depois da migração: **bot.db de 444KB para 68KB**, com o cache nos seus 492KB à parte.
  - `ATTACH` numa conexão só, em vez de uma segunda conexão: transação atravessa os dois arquivos, `close()` fecha tudo, e a separação aparece apenas no prefixo `cache.` das tabelas. A migração move as três tabelas e faz checkpoint + `VACUUM` — sem isso o arquivo continuaria do tamanho antigo, que era justamente o ponto.

- **Paginação virou um módulo só.** [`pagination.js`](src/pagination.js)
  - `/recent`, `/topplays` e `/score` tinham cada um a sua cópia dos botões, do cache de embed, do coletor, da checagem de dono e do encerramento — três lugares para corrigir cada defeito, e as cópias já tinham divergido em detalhes. Agora o comando só diz quantas páginas existem e como montar uma. Saldo: **106 linhas a menos** nos comandos, 91 num lugar só.

- **`i18n.js` (626 linhas) virou um arquivo por idioma.** [`i18n/`](src/i18n/)
  - Acrescentar uma chave exigia editar três blocos distantes no mesmo arquivo — o atrito de todas as sessões recentes. Cada idioma agora é um módulo que recebe o rótulo do servidor administrado e devolve as strings.
  - Junto veio um teste de **paridade**: os três idiomas precisam ter as mesmas chaves, dos mesmos tipos, com a mesma aridade nas funções. O erro fácil (acrescentar chave só num idioma, e o bot responder `undefined` para quem usa os outros) passa a falhar no teste em vez de em produção.

- **`osuClient.js` (951 linhas) deixou de ser o módulo-deus.** [`pp.js`](src/pp.js), [`mods.js`](src/mods.js), [`inflight.js`](src/inflight.js)
  - Saíram o cálculo de PP com os dois motores e o download dos `.osu` que os alimenta (`pp.js`), a tradução entre bitmask/acrônimo/texto de mods (`mods.js`) e a deduplicação de requisições em voo (`inflight.js`). Restaram 735 linhas de cliente de API e normalização.
  - A dependência é de mão única — o `osuClient` importa de `pp`, nunca o contrário — e ele **reexporta** o que saiu, então nenhum comando precisou mudar.

- **ESLint, com regras só de erro.** [`eslint.config.mjs`](eslint.config.mjs)
  - Nada de estilo: o `recommended` do próprio ESLint já é o recorte de "isso está errado" — variável não definida, variável não usada, código inalcançável. `npm run lint`.
  - **Achou dois bugs de verdade na primeira execução**, ambos introduzidos na extração do `pp.js` e ambos invisíveis para o que existia antes: o `idSegment` (usado no download de `.osu`) e o par `_rosu`/`_rosuTried` (usado no cálculo por rosu-pp) tinham ficado no `osuClient`. `node --check` não pega, porque a sintaxe está correta; os 128 testes não pegaram, porque não tocam a rede; e o smoke passou porque o mapa estava em cache e o caminho do Relax vai por Python. O primeiro download de mapa novo teria estourado `idSegment is not defined` em produção.
  - As duas peças foram para onde deviam: `urlSafe.js` (escapar segmento de URL, usado pelos dois módulos) e o estado do rosu-pp dentro do próprio `pp.js`. Junto saiu um `officialPost` morto desde que as estrelas passaram a ser calculadas localmente.
  - Os dois pontos que usam caractere de controle em regex de propósito (higienizar motivo de moderação, e o teste disso) levaram `eslint-disable-next-line` com o motivo escrito.

- **Testes viraram parte do projeto.** [`test/`](test/)
  - `npm test` respondia `Error: no test specified` e tudo que existia vivia em pasta temporária. Agora são **128 casos** no runner nativo do Node (`node --test`, sem dependência nova), rodando em ~2s: registro de servidores, comandos por texto, contexto de mapa, emojis, assinatura administrativa, nomeação e migração de banco, limiar e paridade de i18n.
  - O teste que depende de rede ficou fora do `npm test`, em `npm run smoke`: uma falha lá é o servidor fora do ar, não regressão de código. Também entraram `npm start` e `npm run deploy`.

## 🔒 Segurança

- **Os comandos por texto passaram a conferir `default_member_permissions`.** [`prefixCommands.js`](src/prefixCommands.js)
  - O Discord aplica essa declaração **só no slash command**; no modo texto não existe nada equivalente. Até aqui a única barreira era a checagem dentro de cada `execute` — funcionava, mas por convenção: bastaria um comando futuro confiar só na declaração para nascer aberto a qualquer um. Agora o dispatcher lê o bitfield do próprio JSON do comando e exige do autor da mensagem, fechando a classe inteira em vez de comando por comando.
  - `"0"` é tratado como **Administrator**, não como "todo mundo" — no Discord esse valor quer dizer "ninguém, exceto quem administra o servidor", e um `.has(0n)` responderia o contrário.
  - Não substitui a checagem no comando: as regras por canal e por cargo que o dono do servidor configura em Integrações continuam invisíveis para o modo texto, e o `execute` segue com a palavra final. Está escrito no código.

- **Credencial que nada usava saiu da configuração.** [`servers.js`](src/servers.js)
  - `SERVER_<CHAVE>_KEY` (antes `PRIVATE_API_KEY`) era lida pelo registro e **nunca enviada a lugar nenhum** — nenhum dos endpoints que o bot usa pede autenticação, o que ficou confirmado no teste ao vivo contra os três servidores. Credencial parada não compra nada e ainda aparece em backup, captura de tela e `docker inspect`.

- **`deploy-commands.js` parou de imprimir o erro cru.** Era o único ponto fora do `logger.js`, que existe justamente porque um erro de requisição carrega a configuração dela junto — incluindo o header `Authorization`.

- **O limiar de nomeação passou a contar contas do JOGO, não contas do Discord.** [`db.js`](src/db.js)
  - A PK de `map_nominations` era `(set_id, target_status, discord_id)`, então duas contas do Discord ligadas ao mesmo osu! id valiam duas nomeações: uma pessoa sozinha atingia um limiar de 2 e aplicava ranked/loved. A identidade que conta é a do jogo — é dela que o privilégio de nominator é lido, é ela que o limiar quer contar.
  - A chave virou `(set_id, target_status, osu_id)`; o `discord_id` continua guardado, mas como registro de quem operou. Nomear de novo (inclusive de outra conta do Discord) atualiza a linha em vez de virar um segundo voto, e o `withdraw` passou a ser por conta de jogo — quem nomeou de um Discord consegue retirar de outro, porque é a mesma pessoa.
  - Migração reconstrói a tabela (SQLite não altera PK) dentro de uma transação, mantendo em cada colisão a nomeação **mais antiga** — a que de fato aconteceu primeiro. A detecção é pelo próprio schema (`discord_id` ainda na PK?) em vez de flag no `meta`: fica idempotente por construção, sem depender de o registro da flag ter sobrevivido.

- **Ações administrativas passaram a ir assinadas com o Discord de quem pediu.** [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - O `userId` publicado no Redis é a conta de **jogo** do staff — é ela que o bancho grava como autor. Mas quem apertou o botão foi uma conta do **Discord**, e o vínculo entre as duas vive só no `staff_links` do bot. Como o `/staff register` é auto-declarado do lado do jogo, quem tem Administrator no Discord pode apontar a própria conta para o nick de outro staff e agir com o privilégio dele: o log de auditoria do servidor culparia o dono da conta, e o único registro do Discord real (`admin_actions`) fica dentro do bot — ou seja, dentro do componente que teria sido comprometido.
  - Agora todo `restrict`/`unrestrict` leva ` | via KurataniBot: @nome (discord_id)` no motivo, então o log do **servidor** guarda as duas pontas e a auditoria deixa de depender de o bot estar íntegro. A assinatura é feita no ponto de publicação, não no comando, para nascer em qualquer call site futuro.
  - O motivo do usuário é higienizado antes: caractere de controle vira espaço (senão um `\n` desenha linha falsa no log) e o próprio marcador é neutralizado (senão o motivo forjaria uma segunda assinatura apontando para outra pessoa). Num motivo longo, quem é cortado é o texto — a assinatura nunca.
  - **Não resolve a raiz**, e isso está escrito no [`commands/staff.js`](src/commands/staff.js): continua sendo possível agir em nome de outro, só deixa de ser possível sem rastro. A correção de verdade é provar posse da conta antes de vincular (código temporário no perfil do osu!, ou OAuth do servidor) — em aberto de propósito, para quando o fluxo administrativo for testado contra um bancho.py real.
  - O canal `rank` não tem campo de motivo no payload que o bancho espera, então nomeação/desqualificação seguem sem assinatura desse lado — o rastro delas é o `admin_actions` local.

## 🧹 Limpeza / estilo

- **`pp_calc.py` não escreve mais arquivo temporário.** O `.osu` vai direto de stdin para a lib em memória (`Beatmap(bytes=...)`). Antes passava por um `NamedTemporaryFile(delete=False)`: quando o Node matava o processo pelo timeout de 12s, o `finally` que apagava não chegava a rodar e o arquivo ficava para trás. Conferido que o resultado não muda — mesmo `{ pp: 88.7373, stars: 4.5402, maxCombo: 313 }` do teste do README.
- **O Redis é fechado no shutdown.** O `closeRedis()` existia e nunca era chamado.
- **`uncaughtException` continua logando e seguindo**, agora com a troca escrita no código: o certo é sair com código 1 e deixar um supervisor subir de novo, mas sem supervisor configurado sair deixaria o bot fora do ar até alguém perceber. Trocar quando o deploy tiver systemd/pm2.

## 🔧 Mudanças

- **`NOMINATION_THRESHOLD` passou a valer 1 por padrão** — quem nomeia já aplica. [`commands/nominate.js`](src/commands/nominate.js)
  - O 2 vinha do osu! oficial (dois BNs), mas lá ele resolve um problema que servidor pequeno não tem: com poucos nominators, exigir um segundo só trava mapa esperando alguém aparecer. Quem quiser o modelo do osu! sobe o número no `.env` — a fila, o `withdraw` e o `/nominate queue` continuam iguais para limiar maior que 1.
  - Com limiar 1 o embed deixa de anunciar "limiar atingido": não houve espera, seria ruído.

## ✨ Novos recursos

- **Servidores viraram configuração, não código.** [`servers.js`](src/servers.js)
  - O bot se dizia "Bancho e Daycore", mas o código sempre tratou o Daycore como "o servidor que não é o oficial": tudo decidia por `mode === 'official'` e a única coisa específica eram três URLs no topo do `osuClient`. Agora elas saem de um registro montado do `.env` — `SERVERS=daycore` + `SERVER_DAYCORE_URL`, com `_RELAX=true` criando a variante RX. Hospedar o bot para outro servidor bancho.py não exige tocar no projeto.
  - Só a URL do site é obrigatória: as de API seguem a convenção do onl-docker (`api.<domínio>`, `a.<domínio>` para avatar), sobrescrevíveis uma a uma. O label padrão é a chave capitalizada.
  - **`'private'`/`'private_rx'` deram lugar a `daycore`/`daycore_rx`** (a chave de cada servidor). As 8 cópias do `addChoices({name:'Bancho'...})` viraram `servers.choices()` — antes, adicionar um servidor pedia editar 8 arquivos e ainda assim o `osuClient` não saberia falar com ele.
  - Migração no `bot.db` para as chaves novas, no mesmo estilo das anteriores: `preferred_server` e `user_links.namespace` passam a apontar para o primeiro servidor configurado. `PRIVATE_SERVER_URL`/`PRIVATE_API_KEY` da configuração antiga continuam valendo — viram um servidor com a chave tirada do domínio (`daycore.org` → `daycore`), com RX ligado.
  - O `mapContext` reconhece link de **qualquer servidor configurado**, não mais só `daycore.org` cravado, e o domínio diz de qual servidor o mapa é. Cada servidor também ganhou seu próprio bucket no rate limiter: são hosts diferentes, e um lento não tem por que segurar a fila do outro.
  - Os textos administrativos pararam de dizer "Daycore" na mão — o nome vem do registro (`ADMIN` no [`i18n.js`](i18n.js)), então quem hospeda para outro servidor lê o nome do seu. A estrutura dos comandos de staff continua igual: um servidor só, travado por `DAYCORE_GUILD_ID`.
  - O `servers.js` chama `dotenv.config()` por conta própria. Sem isso, qualquer ponto de entrada que o carregasse antes do dotenv montaria um registro **vazio**, e todo servidor privado cairia calado no oficial — foi o que aconteceu no primeiro teste contra a API de verdade.

## ⚠️ Limite conhecido

- **"funciona com qualquer bancho.py" é meia verdade.** O rank global e as top plays vêm de `get_rank_cache` e `get_player_scores`, que são da **Shiina-Web** (o front-end), não do bancho.py. Um servidor com outro front responde o resto e falha nesses dois — perfil sai como *Unranked* e `/topplays` vazio. Por isso o registro separa `webApi` (front-end) de `banchoV1`/`banchoV2` (bancho.py-ex): o dia em que valer a pena, dá para prever fallback só nesses dois pontos.

---

# Sessão de 2026-08-10

## ✨ Novos recursos

- **Comandos por texto** — `k!rs mrekk` faz o mesmo que `/rs player:mrekk`. [`prefixCommands.js`](src/prefixCommands.js)
  - Nenhum comando foi reescrito: um adaptador embrulha a `Message` com a superfície que eles já usam da interação (`options.getX`, `reply`, `deferReply`, `editReply`, `user`, `guildId`, `channelId`, `memberPermissions`) e o dispatcher chama o mesmo `execute`. Comando novo nasce funcionando nos dois modos.
  - O parser das opções é **derivado do `data.toJSON()`** de cada comando — nomes, tipos, obrigatoriedade, choices, min/max, tamanho. Escrever isso à mão significaria que mudar uma opção no builder e esquecer do parser deixaria os dois modos discordando calados; e as validações que o Discord aplica ao slash command precisam valer no texto também, senão o prefixo vira o jeito de driblá-las. Pelo mesmo motivo o dispatcher repete a trava de contexto (comando de servidor recusa em DM) e passa pelo mesmo cooldown.
  - Aceita opção posicional (`k!rs pudim2`), nomeada (`k!rs player:pudim2`), **flag** (`k!rs pudim2 -daycore`) e tudo misturado. O `:` só vira separador quando o que vem antes é mesmo uma opção do comando — senão um link (`https://osu.ppy.sh/...`) seria lido como opção `https`.
  - A flag não nomeia a opção, e sim o valor: `-daycore` acha sozinho que quem tem essa escolha é o `server`, `-love` que é o `status` do `/nominate`, `-pt` que é o `lang` do `/language`. Funciona porque as listas fechadas do bot têm valores distintos entre si, e é o que dispensa repetir `server:` em todo comando. Booleana também entra (`-randomize`), e `-500` continua sendo um número negativo, não uma flag. Flag que não casa com nada responde com as aceitas naquele comando em vez de virar nome de jogador.
  - Nick com espaço vai entre aspas (inclusive as `“ ”` que o teclado do celular troca sozinho).
  - **Uma opção opcional pode recusar o token posicional** e deixar passar para a próxima. Vale para lista fechada (`server`, `status`, que só engolem o token se ele for mesmo uma das escolhas) e para o que o comando declarar em `prefix.guards` — hoje só o `map` do `/score`, que exige um ID ou link. Sem isso, `k!c nunca` respondia "não consegui identificar o mapa": no slash o `map` é a primeira opção, então o nome do jogador caía nele. Do mesmo jeito, `k!rs nome do cara` reclama das aspas em vez de dizer que "do" é um servidor inválido. Sendo obrigatória, a opção consome assim mesmo — aí o erro sobre o valor inválido é justamente o que a pessoa precisa ler.
  - **Desligado por padrão.** Ler texto de mensagem exige o intent privilegiado MESSAGE CONTENT, e pedir um intent não habilitado no Developer Portal faz o `login()` ser recusado — o bot inteiro não subiria. Só liga com `COMMAND_PREFIX` no `.env`, e quando o login falha por isso a mensagem diz onde habilitar em vez de repetir o "Used disallowed intents" do gateway.
  - Ephemeral não existe fora de interação: a flag é removida do payload (mandá-la numa mensagem comum é erro) e a resposta sai no canal. O ciclo `deferReply` → `editReply` vira "digitando..." → primeira resposta cria a mensagem → as seguintes editam ela, que é o que mantém a paginação por botões idêntica à do slash.

- **`/score` — todos os scores de um jogador em um mapa**, com atalhos `/c` e `/choke`. [`commands/score.js`](src/commands/score.js)
  - `/score map:<id ou link> [player] [server]` lista cada score do jogador naquele mapa (um por combinação de mods), do maior pp para o menor, 5 por página. Cada linha traz rank, mods, estrelas ajustadas pelos mods, pp, accuracy, combo, hits e quando foi.
  - O **PP de FC** aparece ao lado do pp de todo score que foi choke — é o que dá nome ao atalho `/choke`. Mesmo cálculo do `/recent` e do `/topplays`.
  - Funciona nos três servidores. No Bancho vem de `GET /beatmaps/{id}/scores/users/{user}/all`; no Daycore a busca da tabela de scores é pelo **hash** do mapa, não pelo id, então o id é convertido antes via `/v2/maps/{id}`. Scores com `status = 0` (quit) são descartados, porque o endpoint oficial só devolve play completa e os dois lados precisam mostrar a mesma coisa. [`osuClient.js`](src/osuClient.js)
  - Quando a API não informa o pp — acontece com score de lazer, por exemplo — o valor é calculado localmente a partir dos hits reais, pelo mesmo caminho do `/simulate`, e sai marcado com `~` para não passar por número oficial do servidor.

- **Contexto de mapa por canal.** [`mapContext.js`](src/mapContext.js)
  - `/score` sem a opção `map` usa o último mapa exibido no canal. Assim, quando alguém posta uma play com `/rs`, qualquer pessoa responde só com `/score` para ver as próprias plays no mesmo mapa — que era o pedido original.
  - Alimentado por `/recent`, `/topplays`, `/simulate` e pelo próprio `/score`. O registro fica fora do `buildEmbed` porque os embeds são memoizados: voltar para uma página já vista não passa por lá de novo, mas ainda precisa atualizar o contexto.
  - O escopo é o **canal**, não quem rodou o comando — a graça é justamente reagir à play de outra pessoa. Fica em memória, com TTL de 6h e poda preguiçosa por teto de canais.
  - **Link colado na conversa também conta**, não só embed do bot. Era o primeiro tropeço real do modo texto: alguém posta o link do mapa, manda `k!c` embaixo e ouve que não deu para identificar o mapa, sendo que ele estava logo ali. Só link de `osu.ppy.sh` e `daycore.org` — jogar o texto inteiro no `parseBeatmapId` acharia "mapa" em qualquer `algumsite.com/b/12` que passasse pelo chat.
  - **Varredura do histórico quando a memória está vazia.** O contexto não sobrevive a restart, e o primeiro teste real caiu justo nisso: o link estava na tela, mas fora postado antes de o bot subir. Sem nada lembrado, o `recall` lê as últimas 50 mensagens do canal (uma chamada, só no miss, com o mesmo corte de 6h) e memoriza o que achou. Das mensagens do próprio bot só conta o embed — o texto de "não identifiquei o mapa" traz um link de **exemplo**, e o bot acharia o próprio exemplo como se fosse o mapa da conversa.
  - **Responder a uma mensagem tem prioridade** sobre o último mapa do canal: quem responde está apontando para aquele mapa, e não para o que rolou no canal enquanto digitava. Vale tanto para o link cru quanto para o embed de uma play do bot. Existe só no modo texto — não dá para responder a uma mensagem com slash command —, então o `recall` pergunta por um método (`fetchRepliedMessage`) que só o adaptador de mensagem tem, em vez de fingir mais um campo de interação.

- **Emojis de rank do próprio aplicativo.** [`emojis.js`](src/emojis.js)
  - As grades (SS, S, A...) do `/recent`, `/topplays`, `/score` e `/profile` viram emoji quando existe a imagem em `assets/emojis`. Cada arquivo é enviado uma vez no boot e reaproveitado depois; nada é apagado do aplicativo, para um deploy de uma máquina com a pasta incompleta não derrubar o que a outra subiu.
  - São **application emojis**, não de servidor. Emoji de servidor exigiria o bot estar no servidor dono dele e ter permissão de emoji externo no canal — quebrando justo onde mais importa (DM e servidor recém-adicionado). O do aplicativo funciona em toda guild e em DM, sem permissão nenhuma.
  - A pasta é opcional: sem a imagem daquela grade, ela sai no texto de antes (`**A**`). Arquivo com nome fora da regra do Discord ou acima de 256KB é recusado com aviso no log, e falha no envio de um emoji não impede os outros nem o boot.

- **`/score` no bucket `heavy` de cooldown**, com `c` e `choke` mapeados como aliases — sem isso um alias cairia no bucket `default` e driblaria o limite do comando original. [`cooldowns.js`](src/cooldowns.js)

## 🧹 Limpeza / estilo

- **A opção `avg_pp` do `/pp` virou `avg`.** No slash o nome é clicado, mas no modo texto ele é digitado na mão — e o underline é o caractere mais chato de alcançar no teclado do celular. [`commands/pp.js`](src/commands/pp.js)

---

# Sessão de 2026-08-08

## ✨ Novos recursos

- **`/pp` ganhou o modo "quantas plays"** — `/pp target:<meta> avg_pp:<pp> [randomize]` responde quantas plays de um dado valor são necessárias para atingir a meta, simulando a inserção uma a uma no top 100 ponderado. [`commands/pp.js`](src/commands/pp.js)
  - O valor base de cada play sobe **+1pp** em relação à anterior (700, 701, 702...). Sem isso a média fica presa e o PP trava num teto: plays de 700pp fixos nunca passam de ~13.917pp, então metas acima disso eram inalcançáveis por mais plays que se fizesse.
  - `randomize` varia cada play por uma **fração** do valor dela, não por um número fixo de pp. Medindo as top plays reais de 21 jogadores do #1 ao #10.000, a dispersão relativa fica em ~5% independente do nível — ela escala proporcional ao valor da play, não exponencialmente com o skill. Um ±50 fixo seria 10% para quem joga 480pp e só 3,7% para o mrekk.
  - A amplitude é medida do **próprio perfil** via MAD/mediana (desvio absoluto mediano), não desvio padrão: uma única top play muito destacada do resto inflava a estimativa ao dobro do devido (10% contra ~5% de todo mundo). Limitada a 2,5%–10%, a faixa observada nos perfis reais.

- **`/nominate` — fila de nomeação de mapas do Daycore** (staff). [`commands/nominate.js`](src/commands/nominate.js)
  - Rankear/lovear exige `NOMINATION_THRESHOLD` nomeações de pessoas distintas (padrão 2, como o osu! oficial); desqualificar é imediato, e `force` ignora a fila com privilégio de Administrator.
  - A fila, os votos e o histórico ficam no `bot.db` — o bancho.py-ex não tem conceito de nomeação pendente, só sabe aplicar status final. Novas tabelas `map_nominations`, `nomination_maps` e `admin_actions`.
  - Um mapa é tratado como set inteiro: o canal `rank` age sobre uma dificuldade por mensagem, então o bot publica uma vez por diff e relata quantas confirmaram.

- **`/moderate` — moderação do Daycore** (staff): `restrict`, `unrestrict`, `check` e `log`. [`commands/moderate.js`](src/commands/moderate.js)

- **Integração com o bancho.py-ex via Redis pub/sub.** [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - A API v2 do bancho.py-ex é somente leitura — não existe rota HTTP administrativa. O caminho de escrita é pub/sub: ele assina `rank`, `restrict` e `unrestrict` no boot e aplica o que for publicado. Mesmo mecanismo do admin panel do Shiina-Web, então nada precisa mudar no servidor.
  - Como publicar é **fire-and-forget** (o bancho não responde ao publisher), toda ação é confirmada relendo o estado pela API v2. Quando não dá para confirmar, a resposta avisa em vez de reportar sucesso.
  - Conexão preguiçosa e opcional: sem `REDIS_HOST` o bot sobe normal e só os comandos administrativos ficam indisponíveis, com mensagem clara.

- **`/staff` — registro de identidade para fins de permissão.** [`commands/staff.js`](src/commands/staff.js)
  - `register`, `remove` e `list`, exigindo **Administrador no Discord do Daycore** — uma autoridade real, já que aquele servidor é controlado por quem administra o Daycore.
  - Tabela `staff_links`, separada de `user_links` de propósito (ver a correção de segurança abaixo).

- **Autorização em três camadas.** [`staffGuard.js`](src/staffGuard.js)
  - **Escopo**: os comandos administrativos só funcionam no Discord do Daycore (`DAYCORE_GUILD_ID`). Como o bot é instalável por qualquer pessoa (`UserInstall`/`GuildInstall`), sem essa trava bastaria adicioná-lo ao próprio servidor — onde qualquer um é administrador — para tentar usá-los.
  - **Identidade**: qual conta do Daycore é a pessoa, vinda de `staff_links`.
  - **Autoridade**: o que ela pode fazer, vindo do `priv` lido do Daycore a cada comando — então tirar o cargo de alguém lá revoga o acesso no bot na hora.
  - Todas falham fechado.

## 🔒 Segurança

- **CRÍTICO — escalonamento de privilégio pelo `/link`.** A primeira versão do `staffGuard` usava o link comum (`user_links`) para descobrir a conta Daycore de quem rodava o comando. Mas `/link set` nunca verificou posse: ele só confere que a conta **existe** ([`commands/link.js`](src/commands/link.js)). Isso é correto no propósito original — os comandos de consulta mostram dados públicos, e fingir ser outro não dá nada — e desastroso como base de permissão.
  - **Ataque**: entrar no Discord do Daycore, rodar `/link set <nick_de_um_admin> server:Daycore` e usar `/moderate` ou `/nominate`. O bot leria o `priv` do admin e autorizaria. No teste, a conta usada tinha `priv=31895` — `DEVELOPER + ADMINISTRATOR + MODERATOR + NOMINATOR`, ou seja, controle total do servidor. Pior: o `userId` enviado ao bancho é o do dono do `priv`, então o log de auditoria do Daycore registraria o **admin real** como autor da ação.
  - **Correção**: identidade passou a vir de `staff_links`, alimentada só por `/staff register` (Administrador no Discord do Daycore). O `/link` comum não concede mais nada. Coberto por teste que reproduz o ataque.

- **Senha do Redis podia vazar no log.** A conexão era montada como `redis://user:senha@host` e um erro de conexão do client leva a URL para a mensagem de erro, que o `logError` imprime. Credenciais passaram a ir como campos separados de `createClient`. [`daycoreAdmin.js`](src/daycoreAdmin.js)

- **`allowedMentions: { parse: [] }` no client.** O bot ecoa texto de terceiro (nome de jogador, metadados de mapa, motivo de moderação); barrar menção na origem é mais seguro que confiar que todo call site futuro use embed em vez de `content`. [`index.js`](src/index.js)

- **Tetos nas entradas de texto livre** (`setMaxLength`) e truncagem do que é renderizado a partir do banco. Sem isso, um motivo de até 6000 caracteres estouraria o limite de 4096 do embed e o comando falharia ao responder — possivelmente depois de a ação já ter sido aplicada no Daycore. [`commands/nominate.js`](src/commands/nominate.js), [`commands/moderate.js`](src/commands/moderate.js)

- **`/nominate` e `/moderate` no bucket `heavy` de cooldown.** Uma nomeação publica uma mensagem por dificuldade e relê cada uma até 3 vezes; um set grande são dezenas de chamadas. [`cooldowns.js`](src/cooldowns.js)

## 🐛 Correções de bugs

- **O embed do `/compare` quebrava no celular.** A tabela tinha 40 colunas (duas colunas de nome centralizadas em 12, mais a de rótulos), e o Discord mobile não rola code block na horizontal — ele quebra a linha, deixando a tabela monoespaçada ilegível. No desktop passava despercebido. [`commands/compare.js`](src/commands/compare.js)
  - Reestruturada para rótulo à esquerda e os dois valores lado a lado. A economia vem de três lugares: os nomes saíram das colunas (viraram uma linha de texto normal acima, que quebra sem estragar alinhamento e não deixa um nick de 15 caracteres alargar tudo), a coluna da direita não recebe preenchimento, e os rótulos encurtaram (`Acc`, `Combo`, `Plays`).
  - As larguras são calculadas a partir dos dados, e o separador de milhar é desligado automaticamente quando a linha não caberia — ele ajuda a ler número grande, mas custa 2-3 colunas num rank de 7 dígitos, justamente nas contas do Bancho.
  - Resultado: 40 → 23-25 colunas nos cenários testados (Daycore, Bancho com rank de 7 dígitos, nicks de 15 caracteres, jogador sem rank). A string `compare_header_label`, que rotulava a coluna do meio, ficou sem uso e foi removida dos três idiomas.

- **A busca de jogador no Daycore nunca filtrou por nome.** `resolvePlayerId` chamava `GET /v2/players?name=X`, mas esse endpoint **não aceita** `name` — os parâmetros dele são `priv`, `country`, `clan_id`, `clan_priv`, `preferred_mode`, `play_style` e paginação. O FastAPI ignora query param desconhecido em silêncio, então a chamada devolvia a primeira página de **todos** os jogadores e o código caía no primeiro resultado (`?? results[0]`) quando não achava correspondência. [`osuClient.js`](src/osuClient.js)
  - Confirmado na API real: `?name=BanchoBot` devolve os 16 jogadores do servidor, não um.
  - Funcionava por acidente porque o Daycore cabe numa página de 50: o match exato achava todo mundo, e só nome inexistente caía no fallback — resolvendo para o **BanchoBot** (id 1, primeiro da tabela). A partir de 51 contas, qualquer jogador fora da primeira página resolveria para ele também, fazendo `/link set` vincular a conta errada e `/pp player:<nick>` mostrar outra pessoa, sem nenhum aviso.
  - Corrigido para usar `GET /v1/get_player_info?name=X&scope=info` da API v1 do bancho.py-ex, que faz busca exata de verdade (`users_repo.fetch_one(name=...)`). 404 e 422 passaram a ser tratados como "não encontrado" em vez de erro de rede.
  - Fica registrado que `daycore.org/api/v1` (Shiina-Web) e `api.daycore.org/v1` (bancho.py-ex) são APIs de serviços diferentes apesar do nome — a busca por nome só existe na segunda.

---

# Sessão de 2026-08-07

## ✨ Novos recursos

- **`/pp <target> [player] [server]`** — calcula quanto PP uma **única** play precisaria valer para o jogador atingir um total desejado, e em que posição do ranking de plays ela cairia. [`commands/pp.js`](src/commands/pp.js)
  - Deduz o bônus de PP (playcount etc.) como `pp_total − pp_ponderado` e faz busca binária sobre o PP ponderado, que é monotônico em relação ao valor da play hipotética.

- **Registro automático de slash commands no boot** — o `index.js` compara um hash do conjunto de comandos com o último registrado (guardado em `bot.db`) e só chama a API do Discord quando algo mudou de fato. Acaba a classe de bug "alterei o comando e esqueci de rodar `deploy-commands.js`". O script manual continua funcionando e mantém o hash em dia.

- **Link por servidor, com servidor padrão** — antes havia um único link: linkar o Daycore apagava o link do Bancho, e quem usa nicks diferentes em cada servidor não conseguia manter os dois.
  - `/link set <nick> [server]` — cria/atualiza o link daquele servidor e o adota como padrão. Os links de outros servidores continuam intactos.
  - `/link default <server>` — troca o servidor padrão sem re-linkar.
  - `/link status` — lista todos os links, marcando o padrão com ⭐.
  - `/link remove [server]` — remove um link, ou todos se omitido. Se o removido era o padrão, o padrão cai para o link restante.
  - Comandos sem a opção `server` usam o padrão; com a opção, usam o link daquele servidor. `/recent server:Bancho` puxa a conta do Bancho mesmo com o Daycore como padrão.
  - O link é guardado por **conta**, não por opção de servidor: Daycore e Daycore RX são o mesmo cadastro (muda só o mode, 0 vs 4), então linkar num vale para o outro. Nova tabela `user_links (discord_id, namespace, osu_user, osu_id)` e coluna `users.preferred_server`; migração automática do modelo antigo na primeira execução.
  - `resolvePlayer()` passou a devolver `{ error }` com a mensagem já traduzida, para distinguir "não tem link nenhum" de "não tem link **neste** servidor" — que pedem orientações diferentes.

## 🐛 Correções de bugs

- **O idioma da resposta seguia o servidor de osu!, não a configuração de idioma** — `whatif.js` escrevia `mode === 'official' ? <inglês> : <português>`, usando a variável do **servidor** (Bancho/Daycore) como se fosse a do idioma. Consultar o Daycore devolvia português; consultar o Bancho devolvia inglês, ignorando `/language`. Auditados os 9 comandos: o bug era exclusivo do `whatif.js`. Todo o texto agora passa por `t(interaction)`, que resolve na prioridade correta (usuário > servidor Discord > pt).
  - Também eliminadas 3 strings fixas em inglês que apareciam mesmo em português: `Top 5 (with simulation):`, `(hypothetical)` e o rodapé `based on top N plays`.
  - `i18n.js` ganhou chave `locale` por idioma, para o separador de milhar sair certo (`10.000` em pt, `10,000` em en, `10 000` em ru).

- **Estrelas e PP de FC usavam mecânicas diferentes** — as estrelas vinham sempre da API oficial (lazer) enquanto o PP de FC exibido ao lado respeitava `shouldUseLazer(mode, mods)`. Agora os dois usam a mesma base.

- **`beatmap.free()` não rodava se o cálculo lançasse** — em `getFCpp()` e `simulatePP()` o `free()` ficava depois do `calculate()`, sem `finally`, vazando o buffer Wasm em caso de erro.

- **Comandos sem opção falhavam no Daycore quando o link tinha `osu_id`** — `resolvePlayerId()` fazia `username.trim()`, mas o link passou a fornecer o ID como **número**, e número não tem `.trim()`. Resultado: `/recent` sem opções estourava `TypeError` (exibido como "Verifique se o jogador existe"), enquanto `/recent player:<nick> server:Daycore` funcionava. O Bancho não era afetado porque lá o ID só é interpolado na URL. `resolvePlayerId()` agora normaliza a entrada com `String()` antes de qualquer operação de string.

- **Aviso de depreciação do discord.js** — as 24 respostas efêmeras usavam `ephemeral: true`, depreciado na v14 e removido na v15. Trocadas por `flags: MessageFlags.Ephemeral`.

## 🔒 Segurança

Revisão de segurança de todo o projeto. Achados e mitigações:

- **[Crítico] Dados de usuário podiam vazar pelos arquivos WAL do SQLite** — habilitar `journal_mode = WAL` criou `bot.db-wal` e `bot.db-shm`, que o `.gitignore` não cobria (só listava `bot.db` e `bot.db-journal`). O `-wal` chegou a 580KB de transações recentes contendo IDs do Discord vinculados a nicks do osu! — exatamente o que o comentário do `.gitignore` diz para nunca commitar. Regressão introduzida junto com o WAL nesta mesma sessão. Corrigido: `bot.db-wal` e `bot.db-shm` (e os `.migrated`/`.corrupt` do cache) adicionados ao `.gitignore`.

- **[Médio] Path traversal nos caminhos da API do osu!** — `officialGet(\`/users/${username}/osu\`)` interpolava o nome do jogador sem escapar. Um nome como `../../../wiki/pt` escapava do prefixo `/api/v2` e a requisição ia para outro caminho de `osu.ppy.sh` **com o header `Authorization` junto**. O host é fixo, então o token não vazava para terceiros, mas dava ao usuário um primitivo para fazer o bot emitir requisições autenticadas arbitrárias. Corrigido com `urlSegment()` (encodeURIComponent) para valores livres e `idSegment()` (valida `/^\d+$/`, lança se não for) para identificadores — aplicados nos 8 pontos de interpolação de caminho.

- **[Médio] Exaustão de disco pelo cache de mapas** — `beatmap_files` crescia sem limite; chamar `/simulate` com IDs diferentes gravava um `.osu` novo (~50KB) permanentemente a cada vez. O cooldown limita a taxa, não o total. Corrigido com teto de 1500 mapas (`BEATMAP_CACHE_MAX` no `.env`) e evicção LRU via nova coluna `last_used`, atualizada no máximo a cada 1h para não gerar escrita por leitura.

- **[Baixo] Requisição externa não controlada no `pp_calc.py`** — o script baixava o `.osu` por conta própria, fora do rate limiter e do cache do bot: todo cálculo de PP no Daycore RX gerava uma requisição extra e não contabilizada a `osu.ppy.sh`, com risco de throttling/ban do IP. Agora o Node envia os bytes já em cache pelo stdin. Ganho colateral: o RX passou a aproveitar o cache de mapas.

- **[Baixo] Opções numéricas do `/simulate` sem teto** — `n100`, `n50`, `miss` e `combo` só tinham `setMinValue(0)`, permitindo passar inteiros arbitrariamente grandes direto para a lib nativa de cálculo. Adicionado `setMaxValue(100000)` (os maiores mapas têm ~40k objetos).

Verificado e **sem problemas**: `.env` e `bot.db` fora do controle de versão e ausentes do histórico; `.env.example` sem valores reais; todas as queries SQL parametrizadas (nenhuma concatenação); `spawn()` com array de argumentos e sem `shell: true`, com os argumentos revalidados por `int()` no lado Python; nenhum `eval`/`new Function` nem `require()` dinâmico com entrada do usuário; `npm audit` sem vulnerabilidades; intents do Discord no mínimo (`Guilds` apenas, sem `MessageContent`); `/language server` exigindo Administrator e falhando fechado em DM; paginação validando o dono da interação; e o `logger.js` já omitindo `error.config` para não vazar o header `Authorization` nos logs.

## ⚡ Infraestrutura

Mudanças inspiradas na arquitetura do [BathBot](https://github.com/MaxOhn/Bathbot) (MaxOhn), adaptadas para a escala deste projeto — sem Redis nem Postgres.

- **Cache de arquivos `.osu` em disco** (`beatmap_files` no `bot.db`, TTL 30d). Antes, todo cálculo de PP baixava o arquivo de novo (~50KB, ~1,3s). No `/topplays` isso acontecia para as 5 plays da página e **de novo a cada clique de botão**. Equivale à `osu_map_file_content` do BathBot.

- **Atributos de dificuldade calculados localmente e persistidos** (`map_difficulty`, chave `(map_id, mods_bits, lazer)`). O `getAdjustedStars()` fazia um **POST** em `/beatmaps/{id}/attributes` por play com mods, a cada exibição; agora usa o `rosu-pp` que já estava no projeto. Espelha a `osu_map_difficulty` do BathBot.

- **Rate limiter global por recurso** ([`rateLimiter.js`](src/rateLimiter.js)) — leaky bucket por classe de recurso, no modelo do `Site` do BathBot: `osuApi` 8/s, `osuMapFile` 2/s, `osuOAuth` 1/s, `daycore` 5/s. Antes o único controle era o `BEATMAP_BATCH_SIZE`, que limitava a concorrência *dentro de uma chamada* — nada coordenava requisições de comandos simultâneos.

- **Retry com backoff exponencial e jitter** ([`retry.js`](src/retry.js)) aplicado a todas as chamadas HTTP. Antes só o `fetchBeatmap` tinha retry (1 tentativa, sleep fixo de 1s); o resto tratava um 429 como falha definitiva e devolvia `null` silenciosamente.

- **Deduplicação de requisições em voo** — pedidos concorrentes do mesmo mapa compartilham uma única promise, em vez de disparar requisições idênticas enquanto a primeira ainda não terminou.

- **Memoização de página** no `/topplays` e `/recent` — voltar a uma página já vista refazia enriquecimento, estrelas e PP de FC do zero. Medido: **~2700ms → 3ms**.

- **Cooldown por usuário** ([`cooldowns.js`](src/cooldowns.js)) — modelo de tickets do BathBot (`delay` + `limit`/`span`), com buckets por peso de comando. O rate limiter protege a API; o cooldown impede que uma pessoa monopolize a fila.

- **Cache de usuário em memória** (TTL 60s). O BathBot usa 10 min via Redis; aqui o TTL é curto de propósito, para não exibir PP desatualizado logo após uma play nova.

- **Mutex no refresh de token** — N requisições que encontrassem o token expirado ao mesmo tempo disparavam N POSTs em `/oauth/token`.

- **`beatmap_cache.json` migrado para SQLite** — o arquivo era reescrito por inteiro (`JSON.stringify` do objeto todo) a cada mapa novo, sem limite de tamanho nem evicção. Migração automática na primeira execução; o arquivo antigo vira `.migrated`.

- **SQLite em WAL** (`journal_mode = WAL`, `synchronous = NORMAL`) — leitura concorrente mais barata e segurança contra corrupção em kill abrupto.

- **Encerramento gracioso e robustez do processo** — handlers de `SIGINT`/`SIGTERM` (segundo sinal força a saída, como no BathBot) que desconectam do gateway e fecham o banco; e handlers de `unhandledRejection`/`uncaughtException`, sem os quais uma promise rejeitada fora do try/catch de comando derrubava o processo.
  - Ressalva: no Windows, `taskkill /F` é kill imediato e não dispara o handler. O WAL cobre esse caso.

- **Link guarda o ID numérico do osu!** (`users.osu_id`) — antes só o nome era gravado, então quem trocasse de nick tinha o link quebrado silenciosamente. No Daycore também evita a chamada extra de `resolvePlayerId` a cada comando.
  - Links criados antes desta mudança continuam funcionando pelo nome e passam a usar o ID assim que a pessoa rodar `/link set` de novo.

- **Paginação com timeout por inatividade** — `/topplays` e `/recent` usavam `time: 120_000` (absoluto), então os botões morriam 2 min após o comando mesmo com o usuário navegando. Trocado por `idle`, que reinicia a cada clique.

---

# Sessão de 2026-08-05

Registro técnico das mudanças feitas na sessão de 2026-08-05.

## ✨ Novos recursos

- **`/simulate`** — simula o PP de uma play hipotética num mapa específico, dado `map` (ID/link), `mods`, `n100`, `n50`, `miss` e `combo` (opcional, default FC). Funciona nos três servidores (Bancho, Daycore, Daycore RX).
  - [`commands/simulate.js`](src/commands/simulate.js)
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

- **`/whatif` calculava a posição errada em caso de empate exato de PP** — `simulateWhatIf()` usava `findIndex(p => p.pp === hypotheticalPP)`, que podia pegar uma play real em vez da hipotética (sort estável + empate). Trocado por `indexOf()` com referência de objeto. [`commands/whatif.js`](src/commands/whatif.js)

- **RX podia falhar silenciosamente em servidor Linux** — `calcPPPython` chamava `spawn('python', ...)`, mas a maioria das distros só tem `python3` no PATH. Agora detecta a plataforma (`python` no Windows, `python3` em Linux/macOS) e loga erro se o spawn falhar. Variável `PYTHON_BIN` no `.env` permite sobrescrever.

- **Bot podia crashar inteiro em interações expiradas** — o catch global do `index.js` fazia `interaction.reply()` sem checar se a interação já tinha sido respondida/deferida por dentro do comando; se falhasse, virava uma unhandled promise rejection e derrubava o processo (padrão do Node desde a v15). Agora checa `interaction.deferred || interaction.replied` (usa `followUp` nesse caso) e tem `.catch(() => {})` como rede de segurança.

- `resolvePlayerId()` tratava uma string só de espaços como ID `0` (`isNaN('   ')` é `false`). Trocado por regex `/^\d+$/`.

- **`/simulate` dizia "Full Combo" mesmo com misses** — sem `combo` informado, o rótulo era sempre "Full Combo", inclusive quando o usuário passava misses (contraditório: não existe FC com miss). Agora vira "combo máximo assumido" nesse caso, deixando a suposição explícita. O PP em si já estava correto (a lib aplica a penalidade de miss mesmo com o combo no máximo).

- **`/simulate` aceitava combo maior que o máximo do mapa** — passar `combo: 400` num mapa de 313 exibia `400x/313x`. A lib já trata como o máximo, então agora o embed mostra o valor efetivamente usado.

- **Star rating errado no `/simulate` do Daycore RX** — o ramo do RX usava `difficulty_rating` da API oficial, que é sempre o valor **sem mods** (ex: mostrava 3.23★ para um mapa +DT que na prática é 4.64★). O ramo do rosu-pp já usava o valor ajustado. Agora o `pp_calc.py` devolve JSON (`{pp, stars, max_combo}`) com os atributos do próprio akatsuki-pp — mesmo algoritmo que calculou o PP, já ajustado pelos mods, e sem custo extra (o processo Python já era iniciado de qualquer forma). `calcPPPython()` passou a retornar objeto; `getFCpp()` continua devolvendo apenas o número.

## 🔒 Segurança

- **Vazamento de token em log** — `console.error(error)` em cima de um `AxiosError` sem `.response` (falha de rede) imprimia o objeto inteiro, incluindo `.config.headers.Authorization` (o Bearer token da API oficial do osu!). Criado [`logger.js`](src/logger.js) com `logError()`, que só loga `message`/`status`/`data` — nunca o `config`. Aplicado nos 8 pontos que logavam o erro cru (`index.js` + 7 comandos).

## 🗄️ Infraestrutura

- **Migração de JSON para SQLite** (`node:sqlite`, nativo do Node ≥22.5, zero dependência nova):
  - [`db.js`](src/db.js) reescrito — tabela `users` (link osu! + idioma juntos) e `guild_settings` (idioma do servidor), em `bot.db`.
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

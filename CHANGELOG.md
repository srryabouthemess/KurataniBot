# Changelog — KurataniBot

---

# Sessão de 2026-08-12

## 🐛 Correções de bugs

Estes sete vieram de uma segunda revisão, feita sobre o código que a própria sessão escreveu.

- **`/score` respondia erro genérico em qualquer mapa graveyard.** [`osu/officialApi.js`](src/osu/officialApi.js)
  - O endpoint de scores responde **404 tanto para mapa inexistente quanto para mapa sem placar**, e o bot tratava os dois como falha. Medido: `ranked/loved` → 200 com lista; `graveyard` → 404; `inexistente` → 404, mesma mensagem.
  - Resultado: `/score` num mapa graveyard dizia *"Erro ao buscar os scores desse mapa"* — enquanto o `/recent` exibia a play daquele mesmo mapa numa boa. É **o mesmo padrão do bug do `fetchUser`** corrigido acima: 404 que significa "não tem nada aqui" tratado como falha de rede.
  - Agora devolve lista vazia, e a resposta vira *"mrekk não tem nenhum score em Exorcista no Bancho"*. O 500 continua subindo — engolir esconderia indisponibilidade da API atrás de uma resposta que parece normal. **2 casos de teste**, com stub no axios para exercitar o caminho real.

- **`/score` e `/recent` discordavam sobre mapa que não paga pp.** [`scorePP.js`](src/scorePP.js), [`commands/score.js`](src/commands/score.js)
  - Corrigi a apresentação só de um lado na primeira passada: o `/recent` avisava que o valor não conta para o perfil, o `/score` mostrava `~78.60pp` pelado. Alcançável hoje — mapa **loved** tem placar e não paga pp.
  - O `awardsPP` saiu do `recent.js` para o `scorePP.js`, e a chave de i18n virou `pp_unranked_map` (era `recent_pp_*`, nome que já não dizia a verdade). No `/score` a ressalva aparece uma vez no fim, não por linha: o mapa é o mesmo para os cinco scores da página.

- **A estrela de score sem mods deixou de bater com o site.** [`pp.js`](src/pp.js)
  - Efeito colateral não previsto da chegada do CL: todo score de stable passou a ter `mods: ['CL']`, então `mods.length === 0` deixou de ser verdade para score sem mod nenhum. O `getAdjustedStars` parou de devolver `null`, e o bot passou a calcular localmente o que antes vinha pronto da API — **7.08★ no lugar de 7.13★**.
  - A decisão é preferir a API quando não há mod de dificuldade: é o mesmo número que o site mostra e é mais exato, já que o rosu-pp está dois reworks atrás. Com mods não há escolha — a API só publica o valor sem mods. O teste é `displayMods(mods).length === 0`, não `mods.length`.

- **Só a primeira falha do Python era logada, para sempre.** [`pp.js`](src/pp.js)
  - O guard era um booleano por processo. Se a primeira causa fosse passageira (`stdin vazio para o mapa X`), o problema real que aparecesse depois **nunca** seria mostrado — o bot ficava mudo até reiniciar. Virou um `Set` de mensagens: uma vez por causa, não uma vez por processo.

- **`set_on_lazer` era calculado e nunca lido.** [`osu/officialApi.js`](src/osu/officialApi.js)
  - Mesma classe da chave `#id` do cache achada na revisão anterior: escrita sem leitor. É redundante com o mod CL, que é o sinal usado onde a pergunta é feita — e num score de lazer COM CL os dois discordariam, com o CL certo. Removido, com o porquê registrado.

- **O `x-api-version` ia em toda requisição.** [`osu/officialApi.js`](src/osu/officialApi.js)
  - Conferido que hoje não muda nada nos endpoints de usuário e de beatmap, mas fixar versão de formato é um contrato: quanto menos endpoints presos a ela, menos coisa quebra na próxima. Agora só as três chamadas de score usam o `scoreGet`.

- **O mod CL voltou a aparecer nos scores.** [`mods.js`](src/mods.js), [`commands/`](src/commands/)
  - Eu o tinha escondido por achar que era ruído técnico. É o contrário: o CL é **o** sinal de como a play foi jogada — presente quer dizer mecânica clássica (stable, ou lazer com o mod Classic), ausente quer dizer lazer de verdade. É a mesma distinção que o bot usa para escolher o algoritmo de PP, e não havia nenhum outro indício disso no embed.
  - Continua fora de dois lugares, e por motivo diferente do original: ele não é mod de **dificuldade**. No `getAdjustedStars`, contá-lo fazia um score sem mod nenhum deixar de ser "sem mods" e o bot calcular estrelas localmente em vez de usar o valor da API. E no `/simulate` a simulação já é sempre stable, então digitar CL não muda nada e ecoá-lo enganaria.
  - Por isso o `displayMods` virou **`stripClassic`**: o nome antigo dizia "é assim que se exibem mods", e agora os comandos que exibem score justamente não o usam.

- **Saiu a palavra "Modo" dos rodapés.** [`i18n/`](src/i18n/)
  - `Modo: osu` dizia duas vezes a mesma coisa. O bot atende **só osu!standard** — conferido: o ruleset está fixo na URL da API (`/users/{nome}/osu`), o `gameMode` é 0 (ou 4 no RX, que é standard com Relax), o `mode` é literal `'osu'` nos dois normalizadores e o `pp.js` não tem tratamento de ruleset nenhum. No dia em que atender outro, o valor vira `osu!taiko` / `osu!catch` / `osu!mania`, que já se explicam sozinhos.
  - De quebra saiu uma divergência: o `/recent` mostrava `osu` (vindo do campo) e o `/topplays` tinha `osu!` **cravado** no texto — dois comandos escrevendo a mesma coisa de dois jeitos.

- **A data foi para o fim do rodapé do `/recent`.** [`i18n/`](src/i18n/)
  - Estava espremida no meio, separada por um `|` que destoava dos `•` do resto: `Play 1/50 • Modo: osu | 12/08/2026 • graveyard • Bancho`. Agora fecha a linha, e o separador é o mesmo do começo ao fim: `Play 1/50 • Modo: osu • graveyard • Bancho • 12/08/2026, 15:59:20`.

- **O status do mapa virou informação do rodapé.** [`commands/recent.js`](src/commands/recent.js), [`commands/score.js`](src/commands/score.js)
  - As ressalvas escritas na linha de PP saíram — tanto o *"play não terminada"* quanto o *"mapa não ranqueado, não conta para o perfil"*. Em vez de explicar em texto o que aquele número é, o rodapé passou a dizer **o que o mapa é**: `Play 1/50 • Modo: osu | 12/08/2026 • graveyard • Bancho`.
  - Fica melhor por três motivos: a linha de PP já carrega valor, acurácia e o FC, e mais uma frase ali era ruído; o status vale para os cinco scores de uma página do `/score`, então repetir por linha era errado; e a informação passa a aparecer **sempre**, não só quando o mapa não paga — quem olha sabe se é ranked, loved ou graveyard sem ter que deduzir pela ausência de aviso.
  - O que a play foi continua no campo **Status** (`❌ Quit`), e o `~` na frente do número segue marcando "calculado aqui, não é valor oficial". Só a API oficial manda o campo de status; no bancho.py o rodapé sai sem ele, em vez de afirmar o que não dá para saber.
  - Com isso o `mapAwardsPP` e a chave `pp_unranked_map` ficaram sem leitor e foram removidos — a mesma limpeza que o `set_on_lazer` e a chave `#id` do cache já tinham exigido.

- **Play não terminada deixou de repetir o óbvio.** [`commands/recent.js`](src/commands/recent.js)
  - O aviso *"play não terminada, valor só do trecho jogado"* saiu: o campo **Status** do embed já mostra **❌ Quit** bem na frente, e dizer de novo em texto era ruído numa linha que já carrega o pp, a ressalva do mapa e o valor de FC.
  - O que sobrou é o `~` na frente do número, que continua marcando "calculado aqui, não é valor oficial" — e a ressalva do mapa não ranqueado, que **independe** de a play ter terminado: essa é informação que o embed não carrega em nenhum outro lugar. Duas chaves de i18n a menos nos três idiomas.

- **Dois comentários que já mentiam.** [`commands/recent.js`](src/commands/recent.js), [`commands/simulate.js`](src/commands/simulate.js)
  - O docblock do `describePP` ainda dizia que em play fracassada "NÃO dá para calcular localmente" — o código calcula desde que o `passedObjects` entrou, na mesma sessão. E o `/simulate` era o único ponto de exibição sem `displayMods`: aceitava `CL` como token e ecoava `+DTCL`, dando a entender que o mod mudava alguma coisa quando a simulação já é sempre stable.

Os dois primeiros foram encontrados no uso, olhando a saída real dos comandos. O resto veio de uma revisão do projeto inteiro.

- **O `/whatif` dizia que uma play boa faria você PERDER pp.** [`whatif.js`](src/commands/whatif.js)
  - Com 5860.19pp, simular uma play de 500pp respondia "mudaria em **+227.65pp**, indo para **5651.20pp**" — um total 200pp **abaixo** do atual, e incoerente com o `/pp`, que pedia só 412pp para chegar a 6000.
  - O ganho sempre esteve certo: é uma diferença, e o que faltava se cancela nela. O erro estava no total, que saía do `calcWeightedPP` — a soma das top 100 ponderadas, sem o bônus por playcount nem a cauda das plays além da centésima. Medido na conta que reportou: **436.64pp** ficavam de fora, quase exatamente a diferença observada.
  - O `/pp` já resolvia isso do outro lado (`bonus = currentPP - currentWeighted`, subtraído do alvo antes da busca binária); o `/whatif` nunca somou de volta. Agora os dois concordam no número: uma play de 412.16pp responde **6000.00** nos dois.

- **`/simulate` passou a assumir mecânica stable, e a opção `combo` voltou a funcionar.** [`simulate.js`](src/commands/simulate.js), [`pp.js`](src/pp.js)
  - Uma play hipotética não tem mod CL para consultar, então o `shouldUseLazer` concluía "lazer" — e em modo lazer o rosu-pp não aplica penalidade por combo, porque lá a quebra vem dos slider ends registrados, não de estimativa. Resultado: a opção `combo` do comando não mudava o número.
  - Agora o comando força stable, que é o que praticamente todo mundo joga (hoje quase todo score ranqueado chega da API marcado com CL). No bancho.py já era assim, então a mudança vale só para o Bancho.
  - **Correção do que ficou registrado antes:** "o rosu-pp ignora o combo" só vale para o modo lazer. No stable ele é aplicado, mas **limitado por `n100 + n50 + misses`** — e isso é a fórmula do osu!, não defeito da lib: quebra de combo sem miss é sliderbreak, que o stable não registra, então a estimativa não pode passar do número de julgamentos que não foram 300. Com `miss:5` e nenhum 100, o teto iguala os misses e o combo realmente não muda nada; com 100s na conta, muda bastante — de 1227pp a combo cheio para 623pp a 50x.

- **O bot pedia à API um formato de score que escondia o mod CL.** [`osu/officialApi.js`](src/osu/officialApi.js), [`mods.js`](src/mods.js)
  - O `shouldUseLazer` já decidia a mecânica de cálculo pela presença do mod `CL` — e estava certo desde sempre. Só que **o formato antigo da API não manda o CL**, então a condição nunca era verdadeira: todo score do Bancho era calculado com mecânica de lazer, inclusive os de stable, que são quase todos.
  - Pedindo `x-api-version: 20240529`, o CL chega. E aí a diferença aparece onde dói: o rosu-pp **ignora o combo do jogador em modo lazer**, então scores com combo quebrado saíam muito acima do real. Medido contra o pp oficial em 8 scores: **18,9% de erro médio, agora 7,0%**. O resíduo é o rosu estar dois reworks atrás, não isto.
  - Vieram junto as estatísticas de lazer de verdade para quem joga no lazer (a acurácia do `/recent` do mrekk passou de 95,28% para os 95,46% corretos — o formato antigo converte para acurácia clássica) e o `legacy_score_id`, que diz score a score qual é qual.
  - A tradução fica na borda, num `normalizeScore`, e não espalhada pelos comandos — mesmo desenho dos adaptadores de bancho.py. **Atenção ao formato novo: ele é esparso**, o que vale zero não vem, e um FC sem tratamento viraria `undefined` misses. **7 casos de teste** cobrem isso, o CL e o caminho de volta para o formato antigo.
  - O CL não é exibido: não é escolha de ninguém, é marcador de "jogado no stable", e mostrar "+DTCL" em toda play seria ruído novo — o formato antigo nem mandava esse mod. Conferido que o header não muda nada nos endpoints de usuário e de beatmap.

- **Play não terminada também mostra pp — e o `passedObjects` que faltava.** [`pp.js`](src/pp.js), [`scorePP.js`](src/scorePP.js), [`recent.js`](src/commands/recent.js)
  - Faltava usar um parâmetro que a lib sempre teve. A doc do rosu-pp é literal: *"Amount of passed objects for partial plays, e.g. a fail"*. Sem ele, uma desistência era avaliada contra o mapa **inteiro**: a lib inventava um 300 para cada objeto que a pessoa nunca viu, e o `combo` deixava de fazer qualquer diferença.
  - O quanto isso importava, medido numa desistência aos 120 de 1833 objetos: **332.6pp sem, 101.3pp com**. Com `passedObjects`, as estrelas caem de 7.08 para 5.44 e o combo máximo de 1833 para 184 — ou seja, a dificuldade passa a ser a do trecho jogado, e o combo do jogador finalmente é comparado com algo que faz sentido.
  - Antes de achar isso, o `combo` passado ao `simulatePP` era **silenciosamente ignorado**: 27x e 1833x devolviam o mesmo pp. Não era bug de chamada — é o comportamento da lib quando ela acha que o mapa foi jogado inteiro.
  - No Relax o cálculo parcial devolve `null` em vez de um número: o akatsuki-pp trabalha sempre com o mapa inteiro, e dar o valor cheio para uma play interrompida seria inventar.

- **Play em mapa não ranqueado passou a mostrar o pp calculado.** [`recent.js`](src/commands/recent.js)
  - A API do osu! não expõe pp hipotético — conferido: o `POST /beatmaps/{id}/attributes` devolve `star_rating` e os fatores de dificuldade, **nunca** performance. Para mapa fora de ranked/approved o `pp` do score vem `null` e ponto.
  - Mas o `.osu` é público para qualquer mapa, e o motor de pp já roda aqui. Então o valor existe: `~473.38pp` na play que motivou isso, ao lado do `(FC: ~634.38pp)` que já aparecia. Sai com `~` na frente e a ressalva de que não conta para o perfil — o número é real, o que muda é onde ele entra.
  - Vale só quando o bot **sabe** que o mapa não paga, e o status só vem da API oficial: na prática, Bancho. No bancho.py o campo não existe e o padrão continua sendo confiar no pp do servidor.
  - Play fracassada segue em `0pp` sem cálculo, e a razão é técnica: o `simulatePP` deduz os 300s pela contagem de objetos do mapa, o que só vale para play completa — num quit no meio o número sairia inflado.

- **`/recent` mostrava "0pp" para play em mapa que não paga pp.** [`recent.js`](src/commands/recent.js), [`scorePP.js`](src/scorePP.js)
  - A API devolve `pp: null` em três situações diferentes e as três viravam `0`, o que mentia em duas delas. O caso que apareceu: play do mrekk num mapa **graveyard**, exibida como `0pp` com um `(FC: ~634.38pp)` ao lado — sugerindo que um FC pagaria 634pp, quando pagaria zero igual.
  - Agora cada causa é dita: mapa sem pp sai `0pp — mapa não ranqueado, não dá pp` e **sem** a dica de FC (não há o que deixar na mesa); play fracassada sai `0pp` sem enfeite; e mapa ranqueado com pp nulo — o caso de lazer com CL — é calculado localmente e sai com `~` na frente, como o `/score` já fazia.
  - A distinção entre os dois últimos importa: em play fracassada **não** dá para calcular, porque o `simulatePP` deduz os 300s pela contagem de objetos do mapa e num quit no meio o número sairia inflado. Está escrito no código.
  - O cálculo local virou o `scorePP.js`, compartilhado: era a mesma conta em dois comandos, e as cópias tinham divergido no pior sentido — o `/score` calculava, o `/recent` imprimia zero.

- **Os dois adaptadores discordavam sobre "jogador não existe".** [`osu/officialApi.js`](src/osu/officialApi.js)
  - O contrato do `osuClient` promete `fetchUser → usuário ou null`, e era o que o adaptador bancho.py fazia (o `banchoV1Get` aceita 404 e 422 como respostas válidas). O oficial não tinha `validateStatus` e deixava o axios lançar — então o `if (!user)` dos comandos **nunca rodava no Bancho**: a exceção pulava direto para o `catch`.
  - Na prática, quem errava o nick no `/link set` lia *"Ocorreu um erro ao verificar o jogador"* em vez de *"Jogador não encontrado. Verifique o nome e o servidor."*, e o `/score` respondia *"Erro ao buscar os scores desse mapa"*. O `/profile` escapava porque checava `status === 404` na mão — remendo local de um problema que era do adaptador.
  - Confirmado antes e depois contra a API de verdade: `official -> LANCOU: 404` virou `official -> devolveu: null`, igual ao Daycore.

- **`play_time` numérico derrubava a página inteira do `/topplays` e do `/recent`.** [`osu/banchoPyApi.js`](src/osu/banchoPyApi.js)
  - A expressão testava o valor convertido (`String(raw).includes('T')`) e convertia o valor cru (`raw.replace(...)`): um epoch numérico estourava com *"replace is not a function"*. O `String()` só no teste era o sinal de que o tipo já era incerto ali.
  - O estrago passava do score: o `catch` do `enrichScores` chama a mesma normalização de novo, batia na mesma linha, e a **segunda** exceção escapava do try — o `Promise.all` rejeitava e a página inteira falhava, não só a play problemática.
  - Virou um `parsePlayTime` que cobre os três formatos que a API usa conforme o endpoint (ISO, datetime do SQL, epoch em segundos) e devolve "agora" no que não der para ler — antes um formato desconhecido virava `Invalid Date` e só estourava adiante, no `toISOString()`, longe da causa. **8 casos novos de teste.**

- **Nove `editReply` soltos em bloco `catch`.** [`replies.js`](src/replies.js)
  - `interaction.editReply(s.erro);` sem `await` nem `.catch()` em nove comandos. Quando a interação já tinha expirado — e por causa da mesma lentidão que causou o erro, já que o token vale 15 min e o retry come tempo — a promise rejeitava solta: o processo não caía (o `index.js` tem handler global), mas o log enchia e **a pessoa não recebia aviso nenhum**.
  - Um `safeEditReply` num módulo próprio, em vez de nove `.catch(() => {})` copiados. Não conseguir entregar o aviso é o fim da linha, não um segundo evento a registrar — mesma escolha que o `pagination.js` e o adaptador do prefixo já faziam.

- **Falha ao montar uma página deixava a paginação travada e dessincronizada.** [`pagination.js`](src/pagination.js)
  - O handler do coletor não tinha `try/catch`. Montar a página seguinte faz rede e cálculo de PP; se falhasse, a rejeição vinha **depois** do `deferUpdate`, então o Discord já considerava o clique respondido: a mensagem ficava parada, sem aviso, e o erro só aparecia no `unhandledRejection` global.
  - Pior que o susto: o `page` já tinha sido incrementado. O cursor ficava numa página que nunca chegou à tela, e o clique seguinte partia do lugar errado — pulando uma página a cada falha. Agora o cursor volta para o que está na tela e os botões são restaurados.

- **Os dois caches em memória não tinham teto de verdade.** [`osuClient.js`](src/osuClient.js), [`mapContext.js`](src/mapContext.js)
  - Ao passar do limite, os dois podavam só o que tinha **expirado**. Com tráfego suficiente para encher a tabela dentro da janela do TTL (60s no cache de usuário, 6h no contexto de mapa), tudo está fresco, nada é descartado e o Map cresce sem limite — a condição volta a ser verdadeira na inserção seguinte, e assim por diante. Invisível num bot pequeno, vazamento num bot grande, que é o caso de quem hospeda isto para muita gente.
  - A evicção por excesso usa a ordem de inserção do Map como recência, então as escritas passaram a fazer `delete` antes do `set`: reatribuir uma chave existente **não** muda a posição dela, e sem isso um canal (ou jogador) consultado o tempo todo ficaria parado na posição da primeira vez e seria descartado como se estivesse frio.
  - Junto saiu uma escrita que nunca servia para nada: o cache de usuário indexava `mode:#id` mas **lia** só por texto, então a entrada por ID jamais era encontrada — o dobro de memória sem um acerto sequer. Agora a chave é a mesma nas duas pontas, e uma consulta pelo nome aquece a de quem vier pelo link (o `userLink` manda o `osu_id` quando tem).
  - **3 casos de teste**, conferidos nos dois sentidos: falham no código antigo, passam no novo.

- **`EXIT_ON_UNCAUGHT`: a escolha em falha grave passou a ser de quem hospeda.** [`index.js`](src/index.js)
  - O handler de `uncaughtException` logava e seguia rodando, com um comentário admitindo que o certo seria `process.exit(1)` e que só não era por não haver supervisor configurado. Os dois lados têm razão, e qual vale depende de algo que o código não sabe: se existe alguém para reiniciar.
  - O padrão não mudou — seguir rodando continua certo para quem roda na própria máquina. Com systemd/pm2/Docker configurado, `EXIT_ON_UNCAUGHT=true` faz o processo sair para voltar limpo, em vez de operar sobre estado indefinido. Importa mais aqui do que na média dos bots: este publica ações administrativas num servidor de jogo.

- **A falha do PP do Relax era invisível.** [`pp.js`](src/pp.js)
  - O `stderr` do processo Python nunca era consumido. O `pp_calc.py` faz a parte dele muito bem — escreve a causa exata (`akatsuki-pp-py nao instalado. Execute: pip install akatsuki-pp-py`, `stdin vazio para o mapa X`, `Erro: ...`) — e o Node jogava tudo fora. Quem via "PP do Relax indisponível" não tinha **nenhum** caminho para descobrir o porquê sem rodar o script na mão.
  - A primeira tentativa de correção relatava só quando o `JSON.parse` estourava, e não funcionou: o script trata os próprios erros, então ele escreve no stderr **e** imprime `null` no stdout — o parse tem sucesso e o caminho de erro nunca era alcançado. O relato passou para "não veio número", que é onde a informação de fato está. Achado rodando o `npm run smoke`, não lendo.
  - **Uma vez por processo**, no mesmo espírito do `_rosuTried`: isto é chamado uma vez por play, então um `/topplays` de RX viraria cinco tracebacks idênticos por página. Verificado com 5 cálculos seguidos — uma linha só.
  - Consumir o stderr também fecha um travamento: o pipe tem buffer, e um filho que escreva mais do que cabe nele fica bloqueado até o timeout de 12s matar o processo.

- **Corpo de resposta ia inteiro para o log.** [`logger.js`](src/logger.js)
  - Dois casos reais: um 502 de proxy devolve página HTML completa, e o download de `.osu` usa `responseType: 'arraybuffer'` — um Buffer no `JSON.stringify` vira `{"type":"Buffer","data":[...]}`, **um número por byte**. Multiplicado pelas 4 tentativas do retry, uma queda da API escrevia megabytes por comando. Agora corta em 500 caracteres e corpo binário sai como `<50000 bytes>`.
  - O `JSON.stringify` também ganhou `try/catch`: um corpo circular estourava dentro do tratamento de outro erro, que é o pior lugar possível para uma segunda exceção.
  - **6 casos de teste**, incluindo o que já era a razão de o módulo existir: a credencial do `.config` do AxiosError não pode aparecer no log.

- **Caminho de instalação com apóstrofo impedia o bot de subir.** [`db.js`](src/db.js)
  - O `ATTACH DATABASE` montava o caminho por interpolação de string. Não é injeção (vem do `__dirname`), mas `C:\Users\O'Brien\KurataniBot` quebrava o SQL — e num bot que as pessoas auto-hospedam isso não é hipótese remota. Reproduzido numa pasta com apóstrofo: `FALHOU: near "Brien": syntax error`, um erro que não menciona o caminho em lugar nenhum. Com as aspas dobradas, `OK`.

- **Três comentários que descreviam um código que não existe mais.** [`nominate.js`](src/commands/nominate.js), [`pp.js`](src/pp.js), [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - O `NOMINATION_THRESHOLD` vinha com um aviso para **não confiar nele**: dizia que a contagem era por conta do Discord e que o limiar "só vale de verdade depois de trocar essa unicidade para osu_id". Essa troca já tinha sido feita — a migração no `db.js` reconstruiu a tabela com `PRIMARY KEY (set_id, target_status, osu_id)`. O comentário desaconselhava um recurso que funciona.
  - O caminho do Relax no `getFCpp` afirmava que "o script Python baixa o .osu internamente, então não precisamos fazer o download aqui" — exatamente o oposto do que passou a valer quando os bytes foram para o stdin, justamente para o download parar de escapar do cache e do rate limiter. E o docblock logo acima citava `akatsuki-pp-js ... via Neon/Rust`, um pacote que **não é dependência do projeto**: o motor do RX é o `akatsuki-pp-py`, por subprocesso.
  - O `hasPriv` ganhou o comentário que faltava, depois de conferir o upstream: o teste de bits é o mesmo que o bancho.py faz ao despachar um comando (`player.priv & cmd.priv == cmd.priv`, em `app/commands.py`), e **não** é hierarquia. Os docstrings do upstream dizem "manage users (level 1/2)", o que lê como escada e convida a "corrigir" isto — mas quem tem DEVELOPER sem o bit de ADMINISTRATOR também é recusado pelo `!restrict` in-game, e transformar em hierarquia daria pelo Discord um acesso que o servidor nega. As constantes espelhadas conferem uma a uma com o upstream e com o fork.

- **A falha de comando no slash saía em português para todo mundo.** [`index.js`](src/index.js)
  - Quando um comando estourava no meio da execução, o handler respondia `'Erro ao executar o comando.'` — string crua, fora do i18n. Quem tinha `/language en` ou `ru` recebia português. O caminho do prefixo já respondia a essa mesma falha pelo `error_generic`, traduzido; agora os dois dizem a mesma coisa, no idioma de quem chamou.
  - Resolver o idioma lê o banco, e o banco pode ser exatamente o que quebrou (ou já ter sido fechado por um shutdown em curso). Como este é o último `catch` antes do usuário, uma segunda exceção aqui significaria **não responder nada** — então a leitura do i18n tem fallback para a string fixa.

## ✨ Novos recursos

- **`/help`, o índice que faltava.** [`commands/help.js`](src/commands/help.js)
  - Até aqui a única forma de descobrir o bot era o menu do Discord (que lista os 17 comandos achatados, aliases junto dos originais) ou o README. O `/help` agrupa em **Perfil e plays**, **PP e simulações** e **Configuração**, com os atalhos ao lado do comando que eles chamam — `/recent` (`/rs`) — em vez de ocupando linha própria.
  - A lista é **curada, não derivada** do `client.commands`: derivar traria os quatro aliases e os três administrativos, dobrando o tamanho da resposta sem ajudar quem chegou agora. Mas os nomes são conferidos contra o registro antes de virar linha, então um comando removido some do help em vez de virar uma linha morta.
  - Mostra também **os servidores configurados com as chaves que a opção `server` aceita** (`Bancho` `official`, `Daycore` `daycore`...) — que é justamente a parte que muda de instalação para instalação e não cabe no README de ninguém. Vem de `servers.choices()`, a mesma lista que os comandos oferecem, então não tem como divergir do que é aceito de verdade.
  - Os administrativos (`/nominate`, `/moderate`, `/staff`) só aparecem dentro do Discord do `DAYCORE_GUILD_ID`, onde de fato funcionam. Fora dele o `staffGuard` recusaria tudo, e listá-los seria oferecer o que não dá para usar.
  - Resposta **pública, não ephemeral**: help é o tipo de coisa que se manda no canal para outra pessoa ler. Também mantém os dois modos iguais, já que o adaptador do prefixo descarta a flag de ephemeral. Sem opções, o `k!help` sai de graça pelo `buildSpec`.

- **O prefixo sozinho deixou de ser um beco sem saída.** [`prefixCommands.js`](src/prefixCommands.js)
  - Quem descobria o bot e mandava `k!` para ver o que acontecia recebia silêncio — o `resolveCommand` devolvia `null` e o dispatcher desistia. Agora responde com por onde começar (`/link set`, os três comandos mais usados) e aponta o `/help`.
  - **A exceção é o prefixo exato, não tudo que começa com ele.** `k!qualquercoisa` segue calado, e por um motivo que não mudou: ali o texto pode ser qualquer frase que por acaso comece com o prefixo, e responder a cada uma viraria ruído no canal. O teste guarda os dois lados.
  - Divide o balde de cooldown com o `/help`, e **em cooldown fica em silêncio** em vez de responder "espere Xs" — ninguém pediu para executar nada, e trocar o convite por um erro seria pior do que não responder.

- **Teste que impede o help de mentir.** [`test/help.test.js`](test/help.test.js)
  - Três formas de o catálogo se descolar da realidade, nenhuma visível rodando o bot: citar comando que não existe mais (a linha some calada, porque o `execute` filtra pelo registro), faltar a descrição de um comando (vira `— undefined` para quem usa aquele idioma) e um comando novo nascer fora do catálogo.
  - A terceira é o motivo de a conferência ser **nos dois sentidos**: todo comando registrado precisa estar no help ou na lista de exceções (os aliases e o próprio `/help`). Comando novo agora obriga quem o acrescenta a decidir em que grupo ele entra.
  - O teste de paridade do i18n não cobria o segundo caso: ele compara os idiomas **entre si**, e uma chave pode faltar nos três de uma vez. Com os casos do prefixo sozinho, a suíte foi de 128 para **138 casos**.

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

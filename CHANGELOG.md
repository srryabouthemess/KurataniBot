# Changelog — KurataniBot

---

# Sessão de 2026-08-15 (EZPP Farm)

O bot atende mais um servidor: o **[EZPP Farm](https://ez-pp.farm/)**, com as chaves `ezppfarm` e `ezppfarm_rx`. Ele é bancho.py, mas foi o primeiro a chegar **sem a Shiina-Web** — e era exatamente disso que o registro avisava desde que virou configuração: "um servidor com outro front-end responde o resto e falha nesses dois". O aviso deixou de ser uma nota e virou um caminho de código.

## ✨ Novos recursos

- **EZPP Farm, de fábrica.** [`servers.js`](src/servers.js)
  - Entra como embutido pelo mesmo critério do Akatsuki — servidor grande, API pública e estável, e nada aqui depende de configuração de quem hospeda. Some com `BUILTIN_SERVERS` como o outro, e `BUILTIN_SERVERS=ezppfarm` agora é uma escolha que faz sentido.
  - Vem com a variante Relax (`ezppfarm_rx`), que num servidor chamado *EZ PP farm* não é detalhe: o `mode=4` responde e tem ranking próprio — o #1 vanilla tem 27.054pp, o #1 relax tem 46.732pp.
  - Como é o primeiro embutido do tipo bancho.py, a montagem do servidor saiu de dentro da leitura do `.env` (`banchoPyServer`). Antes um embutido teria de repetir os sete campos à mão, e um deles ficaria para trás no dia em que a forma mudasse.

- **Servidor bancho.py sem Shiina-Web.** [`banchoPyApi.js`](src/osu/banchoPyApi.js), [`servers.js`](src/servers.js), [`osuClient.js`](src/osuClient.js)
  - `webApi: null` no registro (ou `SERVER_<CHAVE>_WEB=none` no `.env`) diz "este não tem front-end Shiina-Web", e as três chamadas que dependiam dela passam a sair do próprio bancho.py.
  - **A falha que isso evita era muda, e é o ponto todo.** `ez-pp.farm/api/v1/get_player_scores` não dá 404: responde **200 com o HTML da página**. `res.scores ?? []` leria isso como lista vazia — perfil *Unranked* e `/topplays` sem nada, sem uma linha no log. Por isso a decisão é declarada no registro e não sondada: quem hospeda sabe qual front-end subiu, e adivinhar custaria uma requisição por consulta para descobrir algo que não muda.
  - **O rank veio de graça, e com um campo a mais.** Sem `get_rank_cache`, a posição sai de `get_player_info` com `scope=stats` — o mesmo endpoint que o `resolvePlayerId` já usa —, que devolve `rank` **e** `country_rank` por modo. O `get_rank_cache` só dava o global; o `normalizeUserPrivate` já aceitava os dois desde sempre e recebia `null` no segundo. Zero vira `null` de propósito (`|| null`, não `??`): quem nunca jogou aquele modo vem com zero, e "rank 0" na tela é pior que *Unranked*.
  - **Os dois `get_player_scores` têm o mesmo nome e formatos diferentes.** A Shiina-Web achata o mapa (`map_id`, `map_set_id`, `map_name`) e chama o id de `score_id`; o bancho.py aninha o mapa em `beatmap` e chama o id de `id`. A tradução (`nativeScore`) acontece **na entrada**, e é o que mantém o `normalizeScorePrivate` e o `enrichScores` sem um segundo caminho — eles nunca ficam sabendo de qual dos dois o score veio.
  - O `map_name` é **remontado** no formato de nome de arquivo (`Artista - Título (Mapper) [Dificuldade]`) em vez de repassar os campos separados, que a resposta nativa traz prontos. Parece o caminho mais longo e é de propósito: os campos separados exigiriam um `if` dentro do normalizador, e é justamente ele que não pode saber a diferença.
  - O combo passou a cair para o lado v1 (`v2?.max_combo ?? v1.max_combo ?? null`), porque a resposta nativa já o traz. Na Shiina-Web o campo não existe e o `?? null` continua valendo — nada muda para o Daycore.

## 🐛 Correções

- **`supportsPlayerGroups` respondia pelo tipo do servidor, e passou a responder pelo servidor.** [`osuClient.js`](src/osuClient.js), [`banchoPyApi.js`](src/osu/banchoPyApi.js)
  - Perguntar só se o adaptador expõe o método bastava enquanto todo bancho.py rodava Shiina-Web. Com o EZPP Farm deixou de bastar: o mesmo adaptador atende os dois casos, e a resposta certa depende do servidor.
  - Sem isso, o `/leaderboard` baixaria **uma página de 30-70KB por linha** para raspar selos que não existem naquele front-end, e devolveria lista vazia depois — dez páginas de HTML por comando, para nada. O adaptador agora corta antes de pedir, e o `hasPlayerGroups` diz por servidor.
  - Efeito no EZPP Farm: o `/leaderboard` sai sem selos e o `/topscores` sem o filtro de grupo, que é o correto — o conceito é desenho da Shiina-Web, não do bancho.py.

## 🧪 Testes

- `test/banchoPyNativo.test.js` (novo) trava a tradução do score nativo campo a campo. O estrago dela seria **mudo**: nada estoura, os campos só chegam vazios no embed — mapa `???`, dificuldade `?`, capa quebrada. Inclui os casos degenerados (score sem `beatmap`, mapa sem mapper), onde o risco é inventar `undefined - undefined [?]` como título.
- `test/servers.test.js` ganhou o `SERVER_<CHAVE>_WEB` (`none`, ausente e endereço próprio) e os embutidos do EZPP Farm, incluindo que a variante RX herda o `webApi: null` e o namespace.
- Os casos novos do `WEB` ficaram num bloco **separado**, e está escrito por quê: o `load` limpa o `process.env` e o `defaultKey` lê o `OSU_MODE` na hora da chamada, então recarregar o registro no meio de outro bloco apaga o padrão dos casos seguintes dele. Aconteceu ao escrever isto.
- Conferido ao vivo contra o servidor, nos dois modos: perfil com rank global e de país, top plays com título/dificuldade/mods/combo corretos, plays recentes, ranking e avatares. 428 testes passando.

## 📝 Documentação

- [`docs/OPCIONAIS.md`](docs/OPCIONAIS.md) e [`.env.example`](.env.example) explicam o `SERVER_<CHAVE>_WEB`, o sintoma de esquecê-lo (perfil *Unranked* e `/topplays` vazio, sem erro) e a ausência de grupos sem Shiina-Web.
- O `.env.example` ganhou o `BUILTIN_SERVERS` **comentado**, com o aviso em maiúsculas: ausente = todos, mas **vazia = nenhum**. Deixar a linha ativa e vazia no arquivo de exemplo desligaria Akatsuki e EZPP Farm para quem o copiasse.

---

# Sessão de 2026-08-15 (ranking do servidor)

Dois comandos novos, e duas perguntas que o bot só sabia responder sobre uma pessoa passaram a valer para o servidor: `/leaderboard` mostra o ranking de pp de qualquer servidor que o bot atenda — Bancho (global ou por país), Akatsuki, Akatsuki RX, Daycore e Daycore RX —, e `/topscores` mostra as melhores plays do servidor inteiro, onde a API permite.

## ✨ Novos recursos

- **`/leaderboard` (atalho `/lb`).** [`leaderboard.js`](src/commands/leaderboard.js), [`officialApi.js`](src/osu/officialApi.js), [`banchoPyApi.js`](src/osu/banchoPyApi.js), [`rippleApi.js`](src/osu/rippleApi.js)
  - Dez colocados por página, com `country` opcional para filtrar por país. A opção `server` segue a mesma prioridade dos outros comandos (opção → servidor preferido → padrão), mas **sem exigir link**: um ranking não é de ninguém, e cobrar `/link set` para ver a lista do servidor não faria sentido.
  - Cada tipo de servidor serve isso de um endpoint diferente, e os três foram conferidos contra as APIs de verdade antes de virar código: `/rankings/osu/performance` no oficial, `get_leaderboard` da **v1 do bancho.py-ex** (e não da Shiina-Web, apesar do nome parecido com o `get_rank_cache` que já usávamos), e `/api/v1/leaderboard` no Ripple, onde o `rx` continua sendo dimensão e não modo de jogo.
  - **O número da esquerda é a posição na lista, e não o rank que a API mandou.** Os três discordam sobre esse campo: o bancho.py não devolve rank nenhum; o oficial e o Ripple devolvem o rank **global** mesmo numa consulta por país — medido, o #1 do Brasil chega como `global_rank: 51`. Publicá-lo daria uma coluna que não bate com a ordem exibida, então a normalização o descarta de propósito, e um teste trava a decisão.
  - **A lista inteira vem de uma vez (100) e a paginação acontece em memória.** É o contrário do `/topplays`, que busca 100 e enriquece só a página exibida — lá cada play custa requisições extras (estrelas, pp de FC, metadados), aqui a resposta do ranking já traz tudo que a linha mostra. Clicar em ▶️ não toca a rede, e o `prefetch` da paginação não teria o que aquecer.
  - **Cache de cinco minutos, e não o de um minuto do perfil.** Aquele é curto porque o pp do jogador e a lista de top plays aparecem no mesmo embed e teriam de envelhecer juntos; um ranking não tem esse par. O que os cinco minutos compram é o comando repetido no canal — que é como um ranking costuma ser consultado — não pagar rede nenhuma.
  - A acurácia da linha passa pelo idioma, e não pelo `toFixed(2)` do embed de play: ela divide a linha com um pp de cinco dígitos e com o número de plays, os dois já formatados assim. Em pt-BR o `toFixed` daria `32.138,70pp • 98.26%`, dois separadores decimais na mesma linha.
  - A bandeira é montada dos indicadores regionais em vez de `:flag_br:`, que depende da tabela de emojis do Discord e sairia como texto cru para um código que não esteja lá. `XX` — o que o bancho.py grava para conta sem país — não vira bandeira nenhuma.

- **`/topscores`: as melhores plays do servidor inteiro.** [`topscores.js`](src/commands/topscores.js), [`banchoPyApi.js`](src/osu/banchoPyApi.js)
  - Cinco por página, cada linha com o mapa, os mods, as estrelas, quem jogou e o pp que a play daria com FC — o mesmo desenho do `/topplays`, que ganhou um campo `autor` opcional no [`embeds/play.js`](src/embeds/play.js) porque aqui cada linha é de uma pessoa diferente.
  - **Comando próprio, e não uma opção dos dois vizinhos.** No `/topplays`, "sem `player`" já quer dizer *eu* (via `/link`) e `server` já quer dizer *em qual servidor procurar esse jogador* — os dois sinais que serviriam estão ocupados. No `/leaderboard`, cada linha é um **jogador**; aqui é um **score**, o que mudaria título, formato, rodapé e tornaria o `country` de lá sem sentido.
  - **Só em servidor bancho.py, e a recusa explica o motivo.** A API do osu! não tem esse dado: os tipos de ranking são `performance`, `score`, `country` e `charts` — `top-plays`, `top_plays`, `topplays`, `top-scores`, `scores` e `plays` respondem `invalid type specified`. A página `/rankings/top-plays/osu` existe e traz 100 plays, mas é HTML renderizado no servidor, sem JSON embutido e sem responder JSON nem com `Accept` nem com `X-Requested-With` — só sairia por raspagem, que quebraria calada a cada deploy do front do osu-web. O Ripple recusa sem um mapa (`422 Missing parameters: md5|b`). O despacho é o mesmo do `enrichScores`: o adaptador que sabe expõe o método, e um teste trava que os outros dois **não** o exponham.
  - **A busca é uma varredura, porque o endpoint não ordena.** `sort=pp` e `sort=pp_desc` são silenciosamente ignorados — a mesma armadilha do FastAPI que já mordeu o `resolvePlayerId` com `name`. O `status=2` (melhor score de cada jogador em cada mapa) encolhe a tabela de 20+ páginas para 4 no Daycore.
  - **E por isso o teto recusa em vez de truncar:** sem ordenação do lado do servidor, meia varredura não dá resposta incompleta, dá resposta **errada** — as primeiras 3000 linhas por ordem de inserção não têm relação com as 50 maiores por pp. Acima do teto o comando diz que não sabe.
  - **`/v2/maps?md5=` também ignora o filtro** — pedido um hash, devolveu 50 mapas com outro no topo. A resolução vai pela v1 (`get_map_info`), que de quebra entrega artista, título, dificuldade, estrelas e combo em campos separados: o embed sai com o artista no lugar certo, em vez de desmontado do nome do arquivo por regex como no resto do adaptador.
  - Medido, com os caches quentes: 12 requisições e 1,2s numa página fria do Daycore (4 da varredura + mapa e nick dos cinco scores), e **zero** no comando repetido dentro dos 5 minutos de cache. Para comparar, uma página do `/topplays` no mesmo servidor gasta 11.

- **Os grupos do servidor entraram nos dois comandos, do jeito que o site usa.** [`banchoPyApi.js`](src/osu/banchoPyApi.js), [`leaderboard.js`](src/commands/leaderboard.js), [`topscores.js`](src/commands/topscores.js)
  - O Daycore marca contas com selos — ❌ Cheating, 🗿 Fuquila, ✅ Legit, 🐾 puppy, além de Developer/Moderator/Nominator/Supporter —, e o site trata os dois lados de forma **diferente**: o leaderboard mostra todo mundo com os selos ao lado do nick, e a página Top Plays **exclui** Cheating e Fuquila por padrão, com botões para incluir. Os comandos agora fazem exatamente isso.
  - **Onde esse dado vive, e por que ele demorou a aparecer:** não é o `priv` do bancho.py nem o `client_flags` do score — é uma tabela do front-end (Shiina-Web), e nenhuma das 62 rotas da API a expõe, nem o `custom_badge_name` (nulo em todo mundo). Nem dá para derivar do `priv`: a yumi tem os bits de ADMINISTRATOR e DEVELOPER e mostra só "puppy" e "Legit". O único lugar onde os grupos existem é o HTML do perfil, dentro de um `div.groupPlace` — a mesma página que a prova de posse de conta já lia.
  - **O `/topscores` estava mostrando outro pódio.** Antes disto ele exibia koujrbe (❌ Cheating) em #1 com 1610pp, enquanto o site diz que o #1 é a yumi com 1032pp. Agora as cinco primeiras linhas batem uma a uma com daycore.org/topplays, e o número de plays escondidas — **65** — é exatamente a diferença que o site mostra entre o padrão (228 entradas) e o `?cheating=1` (293).
  - O filtro acontece **antes** de cortar as 50: cortar primeiro deixaria buracos no meio das posições. Por isso o adaptador passou a devolver a lista inteira ordenada, sem corte.
  - Custo: uma página de perfil por **jogador** (não por play), com cache de meia hora — a lista inteira do Daycore é de menos de dez pessoas. No `/leaderboard` são os dez da página exibida.
  - **Na tela do `/leaderboard` só aparecem ✅ Legit, ❌ Cheating e 🗿 Fuquila.** Exibir os oito virava fileira de emoji — o kyou sozinho carregava seis (🐾✍🛡️✅🛠️🌟), empurrando o nick e competindo com a bandeira. Os três que ficam são os que falam do **número ao lado**, e o recorte não é opinião nossa: Cheating e Fuquila são exatamente os dois que o site tira do Top Plays, e Legit é o contrário deles. Cargo (Nominator, Moderator, Developer, Supporter) e apelido interno (puppy) dizem respeito à pessoa, não à posição dela. Aqui os selos só são **exibidos**: quem esconde play é o `/topscores`.
  - O clã, que o site mostra antes do nick (`[flau] nunca`), também saiu: numa linha que já tem posição, bandeira, nick e selo, ele era o quarto enfeite antes do número que a pessoa veio ler. O campo `clanTag` saiu junto da normalização dos três adaptadores — dado que ninguém lê é peso morto, e o `clan_tag` continua na resposta do servidor para o dia em que alguém for exibi-lo.
  - **O terceiro filtro do site ficou de fora, e está escrito no código por quê:** "Loved Maps" custaria o status de cada mapa da lista, e o caminho barato para saber quais são loved é enumerá-los — 1978 mapas, 20 requisições. A divergência é conhecida e medida: 248 plays aqui contra 228 no site.
  - No osu! oficial e no Akatsuki nada disso existe, e o despacho por capacidade (`supportsPlayerGroups`) faz esses dois nem perguntarem: a lista deles sai igual à de antes, sem custo nenhum a mais.

## 🐛 Correções

- **O `/wipe` deixou de recusar a própria conta; o `/moderate` continua recusando.** [`wipe.js`](src/commands/wipe.js)
  - A trava tinha sido copiada de um comando para o outro, e só num deles ela se sustenta. No `/moderate` é estrutural: sem ela, um staff restrito poderia se **desrestringir** — é escalada de privilégio, e por isso fica.
  - No `/wipe` não há esse ganho: ninguém obtém nada apagando os próprios scores. Sobrava o argumento do engano, e contra engano este comando já tem o que o outro não tem — a confirmação mostra os números que serão destruídos (`3076pp, 679 plays`) e expira em 60 segundos. O que a trava impedia, na prática, era um Developer limpar a própria conta de teste.
  - A ausência ficou **escrita no lugar dela**, com o porquê da assimetria: sem isso, a próxima leitura lado a lado dos dois arquivos convidaria alguém a "restaurar a simetria" e a devolver o problema.

- **O `/top` driblava o cooldown do `/topplays`.** [`cooldowns.js`](src/cooldowns.js)
  - Encontrado ao acrescentar o `/lb` na mesma tabela. O bucket é escolhido pelo **nome invocado**, e a lista de aliases cobria `wi`, `rs`, `c` e `choke` — mas não `top`. Resultado: o comando mais caro do bot (o `heavy`, que enriquece cinco plays por página) atendia com o cooldown mais frouxo, bastando escrever o atalho.
  - É a repetição exata do defeito que o comentário ali já contava ter corrigido para o `/wi`, o que mostra que "lembrar de mapear" não era garantia de nada. Agora a lista está completa — `osu` entrou junto, mesmo com o `/profile` no `default` hoje, para o atalho seguir o comando no dia em que ele mudar de bucket.
  - O teste novo não repete a lista: ele lê os atalhos do **catálogo do `/help`**, que o `help.test.js` já confere contra os comandos registrados de verdade. Um atalho novo cai neste teste sozinho, sem ninguém precisar lembrar.

---

# Sessão de 2026-08-15 (segurança)

Revisão de segurança do projeto inteiro, e a correção do único achado explorável por qualquer pessoa. A cadeia de privilégio dos comandos administrativos — a parte que mexe no servidor de jogo de verdade — resistiu à revisão.

## 🧹 Organização

- **As duas cópias da fórmula de PP ponderado viraram uma.** [`weightedPP.js`](src/weightedPP.js)
  - O `/pp` e o `/whatif` respondem perguntas opostas sobre o **mesmo** número ("quanto falta para chegar em X" e "quanto X me daria"), e cada um trouxe a própria cópia da soma `0.95^i` e da inserção da play hipotética. Duas cópias de uma fórmula que precisa concordar é o arranjo que já custou caro aqui: o pp local do `/score` e o do `/recent` divergiram, um calculava e o outro imprimia zero.
  - O detalhe que viajou junto: a play hipotética é procurada por **referência**, e não por valor de pp — num empate exato, o `sort` estável deixa a hipotética depois da real, e procurar pelo número devolveria a posição da outra. Os dois comandos documentavam isso separadamente; agora é uma explicação só, no lugar onde a busca acontece.
  - Como é refatoração, o teste compara a peça nova com a implementação **antiga**, escrita no arquivo de teste como referência: mesma soma, mesma posição, mesmo "entrou" — com 0, 1, 5, 50, 100 e 137 plays.

- **A linha do autor deixou de ter cinco versões.** [`pp.js`](src/commands/pp.js), [`whatif.js`](src/commands/whatif.js)
  - A refatoração dos embeds centralizou `nick: 4.821,30pp (#12 BR#3)` no `embeds/play.js`, mas deixou para trás quatro cópias — três no `/pp` e uma no `/whatif` — que a essa altura já **discordavam** da versão boa: sem separador de milhar e sem o idioma no `toLocaleString`.
  - Junto veio uma inconsistência que a correção expôs: no `/whatif`, o autor passou a dizer `32.138,70pp` enquanto a descrição logo abaixo dizia `32138.70pp`, no mesmo embed. O formatador virou peça exportada, e os dois passaram a usá-lo.

## 🔒 Segurança

- **A prova de posse de conta passou a olhar só o que o dono escreve.** [`staff.js`](src/commands/staff.js)
  - O `/staff confirm` procurava o código na **página de perfil inteira**, e o argumento parecia bom: não depender de classe de CSS nem de estrutura, que mudam a cada tema. Só que naquela página cabe muito texto que não é do dono da conta — nome de mapa que ele jogou, clã, o que mais o tema renderizar.
  - E quem emite o desafio é justamente a parte que este fluxo **não confia**: um administrador do Discord que peça o vínculo de outra pessoa conhece o código. Bastava fazê-lo aparecer em qualquer canto daquela página — subindo um mapa com aquele nome e levando o alvo a jogá-lo — para o vínculo de staff ser criado em nome dela. É o mesmo furo que o desafio existe para fechar, por outra porta.
  - Agora o código só vale dentro do bloco `userpage`, que é o pedaço que só muda por quem entra na conta. A varredura conta abertura e fechamento de `<div>` em vez de parar no primeiro `</div>`: o conteúdo é escrito pela pessoa e pode ter div dentro.
  - **Conferido contra o servidor de verdade**, e não só contra fixture: em perfis reais do Daycore, o bloco existe e contém exatamente o texto salvo; com o código dentro dele o recorte confirma, com o código plantado no fim da página recusa. Perfil vazio **não renderiza o bloco** — e aí "não confirmado" é a resposta certa, porque quem não salvou nada também não salvou o código.
  - Falha fechado, como o resto da porta administrativa. E o caso em que o código aparece na página **fora** do bloco vira log: é o sintoma de exatamente duas coisas — o tema mudou, ou alguém plantou o código onde a pessoa não controla —, e as duas pedem olho humano.

- **Três arestas menores da mesma revisão.** [`beatmapFile.js`](src/beatmapFile.js), [`staffGuard.js`](src/staffGuard.js), [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - **Download de `.osu` ganhou teto de tamanho** (16MB). Tinha teto de tempo, não de bytes — e o teto do cache conta arquivos, não espaço. Exige o osu! respondendo o que não devia, já que o host é fixo, mas era a única resposta que o bot lia sem limite nenhum.
  - **O erro do Redis saiu da tela e foi para o log.** A mensagem do cliente costuma trazer host e porta; quem lê a resposta no Discord não faz nada com isso, e quem diagnostica tem o log. Mesmo princípio que o `logger.js` já aplica ao não imprimir o `.config` do axios. A chave de i18n virou texto fixo nos três idiomas.
  - **Um comentário afirmava que a prova de posse era "ainda por fazer"** quando ela já existia há sessões. Num arquivo que descreve controles de segurança isso não é cosmético: o próximo leitor decide o que reforçar a partir do que está escrito, e ali estava escrita uma fraqueza que não existe mais.

- **Texto de fora deixou de entrar cru nos embeds.** [`markdown.js`](src/markdown.js), e os sete pontos que exibem nome de mapa ou de jogador
  - Nome de mapa, de mapper e nick são escolhidos por quem os criou, e o bot os interpolava direto em posição de markdown. Um título com `](url)` fecha o link do bot e abre outro — o embed passa a exibir um **link clicável para onde o atacante quiser**, com a credibilidade do bot em volta.
  - Não era teórico. Prova executada contra o código real, com o título `Musica](https://sitefalso.example/roubo) [clique aqui`: o embed saía com `[MC - Musica](https://sitefalso.example/roubo)`. Custa nada explorar — mapa graveyard não passa por moderação, e `/score <id>` exibe o título de qualquer mapa sem nem precisar jogá-lo.
  - **Escapa exatamente o conjunto que o Discord sabe escapar**, e não "todo símbolo por precaução": diante de um caractere sem significado, a contrabarra aparece na tela. Over-escapar não é conservador, é defeito visível.
  - **Só descrição e content renderizam markdown.** `setTitle`, `setAuthor` e `setFooter` são texto puro — escapar ali imprimiria as contrabarras sem proteger de nada. É por isso que o escape mora nos pontos de interpolação e não dentro do `mapTitle()`: o mesmo texto vai para os dois lugares.
  - Quebra de linha vira espaço antes do escape, senão um título com `\n` ainda abriria cabeçalho ou citação na linha que ele cria — mesma decisão do `signReason`.
  - **O `/compare` precisou de outro tratamento**: os nicks vão dentro de um bloco de código, onde contrabarra não escapa nada. Ali uma crase fecharia a cerca e o resto da tabela viraria markdown; o `short()` passou a removê-la.
  - **Fica de fora, e está documentado:** URL solta continua virando link clicável, e não há contrabarra que impeça. É outro risco — uma URL visível mostra para onde vai; o que se fechou foi **forjar o rótulo**.
  - O caso de regressão é a própria prova de conceito.

---

# Sessão de 2026-08-14 (embeds e latência)

Sessão de aparência, que virou de latência no fim: os comandos que mostram play passaram a desenhar todos do mesmo jeito, no formato denso que a comunidade de osu! já lê sem pensar (o do BathBot); duas correções de número apareceram no caminho, encontradas justamente por olhar as telas lado a lado; e a medição seguinte mostrou que o trabalho local deixou de ser gargalo — o que sobrou é rede, e parte dela era espera que não comprava nada.

## ✨ Novos recursos

- **Um desenho só para toda play exibida.** [`embeds/play.js`](src/embeds/play.js), [`recent.js`](src/commands/recent.js), [`score.js`](src/commands/score.js), [`topplays.js`](src/commands/topplays.js)
  - O `/recent`, o `/score` e o `/topplays` mostram o MESMO objeto e tinham três desenhos. O `/recent` usava campos de embed com rótulo traduzido ("Status", "Estatísticas"), que gastam três linhas de altura para dizer o que cabe em meia; os outros dois já usavam linhas de descrição, mas discordavam entre si — pp entre crases num e em negrito no outro, acurácia entre parênteses num e depois de um ponto no outro, combo entre colchetes só num deles.
  - Agora a forma mora num módulo e os comandos só dizem em que moldura a play vai: **play única** (o embed inteiro) ou **item de lista**. A linha de autor (`pudim2: 3.137,00pp (#4 BR#1)`), que existia em duas cópias divergentes e faltava no `/recent`, saiu junto.
  - **Sem rótulo escrito, de propósito.** "121.21pp", "81.48%" e "55x/284x" se explicam pela unidade que carregam; o que sobrava dos rótulos era ruído traduzido três vezes. O i18n ficou com o que é frase — rodapé, erro, aviso —, e perdeu onze chaves que só serviam para nomear campo.
  - A data saiu do rodapé e virou timestamp relativo do Discord: cada pessoa lê "há 4 horas" no fuso e no idioma dela, em vez de uma data fixa em pt-BR.

- **A linha de informação do mapa.** [`rosuWorkerThread.js`](src/rosuWorkerThread.js), [`pp.js`](src/pp.js)
  - `02:00 • CS 4 AR 9.4 OD 9.6 HP 5 • 128 BPM`, tudo já ajustado pelos mods — com DT a duração encolhe, o BPM sobe e o AR/OD mudam por uma conta que **não** é multiplicação (a janela de tempo é que muda).
  - Por isso ela é feita pelo `BeatmapAttributesBuilder` do rosu-pp, e não à mão em JS: seria uma segunda implementação da mesma regra, livre para divergir do número que o cálculo de PP ao lado usa. Vem da mesma thread e do mesmo mapa já parseado, então não custa requisição nenhuma.
  - A contagem de objetos vem junto, e é ela que dá o `@47%` de uma play interrompida — até onde a pessoa foi antes de parar. Sem o `.osu` a marca some, em vez de virar um "@0%" que parece nota.
  - Cache em memória por (mapa, mods), com TTL: o cálculo é barato, o que se quer evitar é a viagem até a thread a cada virada de página do mesmo mapa.

- **O score total aparece nas plays de servidor privado.** [`banchoPyApi.js`](src/osu/banchoPyApi.js), [`rippleApi.js`](src/osu/rippleApi.js)
  - A pontuação (a de milhões, não o pp) já vinha da API oficial e era descartada pelos dois adaptadores. Zero vira `null`: na tela, um zero pareceria play sem nota.

## ⚡ Desempenho

- **O perfil e os scores do jogador passaram a sair na mesma viagem.** [`userLink.js`](src/userLink.js), e os seis comandos que consultam jogador
  - Todo comando fazia `getUser(nome)` e só então `getBestScores(user.id)`, a segunda esperando a primeira porque precisa do id. Só que quem usou `/link` **já entrega o id**: o `resolvePlayer` devolve o `osu_id` de propósito, justamente para poupar o `resolvePlayerId` de cada comando. A espera pela primeira chamada não comprava nada.
  - Medido em três rodadas, do perfil até a lista de 100 top plays: **638ms → 367ms no Bancho (-271ms)** e **388ms → 175ms no Daycore (-213ms)**. Vale para `/recent`, `/topplays`, `/score`, `/profile`, `/whatif` e `/pp`; o `/score` ganha um terceiro paralelo, porque os metadados do mapa nunca dependeram do jogador.
  - **Só vale para quem tem link.** Escrevendo o nome (`k!rs mrekk`) não há o que paralelizar — o id só existe depois da primeira resposta, e o caminho antigo continua ali.
  - **O `allSettled` não é preciosismo.** Em paralelo a busca de scores parte de um id ainda não validado, e o caso comum de id inválido (conta apagada, link antigo) é justamente ela estourar. Com `Promise.all` esse erro venceria a corrida e o comando responderia "erro ao buscar" no lugar de "jogador não encontrado" — trocando uma resposta que explica o que fazer por uma que não explica nada. A ordem de quem manda ficou explícita: perfil que falha sobe, perfil vazio encerra ali, e só com o jogador existindo é que a falha dos scores importa.
  - O teste trava a corrida sem depender de cronômetro: o perfil só resolve **depois** que a busca de scores começou, então uma versão em série vira impasse. Verificado que ele falha — serializando as duas chamadas de propósito, sai "a busca de scores esperou o perfil, em vez de sair junto".
  - **Medido e descartado na mesma sessão:** camada em memória na frente do `beatmap_meta` (0,023ms por leitura), cache do idioma no `t()` (0,016ms), leitura do `.osu` do SQLite (0,045ms) e a montagem dos cinco blocos de uma página (0,5–1,2ms, com **zero** de event loop parado). O trabalho local não é mais gargalo — a sessão de desempenho de hoje cedo já colheu isso, e o que sobrou na tela é rede.

- **O balde de vazão dos servidores privados: 5/s → 10/s, e agora por HOST.** [`rateLimiter.js`](src/rateLimiter.js), [`banchoPyApi.js`](src/osu/banchoPyApi.js), [`rippleApi.js`](src/osu/rippleApi.js)
  - De 24% a 39% de uma página de servidor privado era espera na **nossa própria fila**, não lentidão do servidor. O 5 nunca foi medido — era cautela, do mesmo tipo que o `osuMapFile` já teve antes de alguém cronometrar.
  - Medido numa página fria de `/topplays` no Daycore (10 requisições), processo novo a cada rodada: **5/s → 1627ms** (163ms de fila); **6/s → 919ms** e daí para cima **sem fila nenhuma**. A diferença entre 8, 10 e 12 com uma pessoa por vez é ruído de rede.
  - O que separa os números é o atendimento **simultâneo**, onde as requisições de duas páginas se somam no mesmo balde: duas páginas frias juntas (19 requisições) custam 3295ms a 5/s, 2310ms a 6, 1518ms a 8 e **1039ms a 10**. Daí o 10.
  - **A chave do balde virou o namespace, e essa metade é correção.** A variante RX é uma entrada própria no registro (`daycore_rx`) do mesmo cadastro no mesmo host: com uma chave por variante, ela abria um balde separado contra a mesma máquina, e o teto real era o dobro do configurado. Um balde que não sabe quantos clientes dele existem não é um limite.
  - Somadas as duas, **10/s é menos carga do que havia antes**: o teto contra a máquina do servidor sai de 5+5 por variante para 10 no total.
  - A troca é de uma palavra (`key` → `namespace`) e some no diff — por isso tem teste, com o Ripple junto (Akatsuki e Akatsuki RX são o mesmo host). Verificado que ele acusa a volta.

- **A lista de top plays virou cache; a de plays recentes não.** [`osuClient.js`](src/osuClient.js)
  - Quatro comandos pedem a mesma lista — `/topplays`, `/whatif` e `/pp` buscam as 100, o `/profile` busca a primeira — e olhar o próprio perfil costuma ser exatamente essa sequência. Cada comando pagava a busca de novo: medido, **350ms (Bancho) e 262ms (Daycore)**, três vezes seguidas pela mesma lista. Agora o segundo e o terceiro custam **0ms**.
  - **O TTL é o mesmo do cache de usuário (60s), e isso não é coincidência.** Os dois aparecem no mesmo embed: o pp do jogador na linha do autor sai do `getUser`, a lista sai daqui. Com prazos diferentes, dava para ver um pp já atualizado sobre uma lista velha — o par contaria duas histórias. O preço é o mesmo que o perfil já cobra: uma top play nova pode demorar até um minuto para aparecer.
  - **A chave inclui o limite.** O `/profile` pede 1 e o `/topplays` pede 100; servir a lista curta para quem pediu a longa cortaria 99 plays em silêncio, e o `/whatif` responderia com uma conta feita sobre uma play só — número plausível, resposta errada.
  - **As plays recentes ficam de fora de propósito**, e é o único lugar do bot onde não guardar é decisão e não esquecimento: o `/rs` existe para responder "o que eu acabei de fazer", e um cache responderia "o que você fez antes".
  - A lista é entregue por referência, e não copiada: conferido que nenhum dos quatro comandos ordena no lugar — todos fazem `[...plays].sort()` ou `slice()`.

- **O detalhe de score do bancho.py virou cache, e o prefetch passou a aquecer a página inteira.** [`banchoPyApi.js`](src/osu/banchoPyApi.js), [`topplays.js`](src/commands/topplays.js), [`recent.js`](src/commands/recent.js)
  - `/scores/{id}` era o endpoint mais caro do bot em servidor privado: **uma requisição por score**, cinco por página do `/topplays` e uma por play do `/recent`, sem nada guardado. Medido numa página de cinco: 294ms numa rodada, 843ms na seguinte.
  - O dado é quase imutável — acertos, combo, mods e data de um score que já aconteceu não mudam mais. O TTL de uma hora existe pelo que **pode** mudar: o pp, quando quem hospeda roda um recálculo em massa.
  - Só o payload da v2 é guardado, e não o score normalizado: o lado v1 da mescla muda conforme quem chama (o `beatmapScores` monta um sintético a partir do mapa), então guardar o resultado pronto serviria a mescla de um no outro.
  - O `prefetch` da paginação adiantava só o `.osu` da próxima página — o que era certo quando o cálculo de PP dominava o relógio. Hoje o cálculo custa zero quente, e o que sobrou na virada de página era justamente o enriquecimento. Agora ele vem primeiro, e o arquivo depois.
  - **Os dois andam juntos de propósito:** o prefetch sem o cache dobraria as requisições (a página seria enriquecida uma vez para aquecer e outra para exibir). E ele criou uma corrida nova — clicar em ▶️ antes de o aquecimento terminar pedia os mesmos scores de novo —, coberta pelo `dedupe` do `inflight.js`, o mesmo que o download de `.osu` já usava.
  - Medido contra o Daycore, com 85 top plays: **página exibida de novo, 306ms → 1ms**; **virada de página, 1640ms → 1ms** (a página seguinte já aquecida). A taxa de acerto do cache numa sessão de quatro páginas ficou em 40%.
  - Falha não entra no cache, resposta vazia entra (é um resultado, e sem isso ela era repedida a cada exibição), e score sem id não cria chave: uma chave `${mode}:undefined` faria scores diferentes dividirem a mesma entrada. Os ids também são separados por servidor — são de cada instalação, e servir o de um no outro exibiria a play errada com um número plausível.

## 🐛 Correções

- **O `npm test` que falhava sozinho de vez em quando.** [`test/concurrency.test.js`](test/concurrency.test.js), os nove `dotenv.config()`
  - Duas ocorrências em rodadas cheias, cada uma num arquivo diferente, e os dois passando sozinhos. Com a máquina ociosa não reproduzia — **32 rodadas limpas**, incluindo 8 com dez processos queimando CPU. O que reproduziu foi oversubscrição de processos: `--test-concurrency=32` em 12 núcleos, **4 falhas em 6 rodadas**.
  - **Causa 1, e a única do projeto: a única asserção de relógio do suite.** O "o item lento não segura os outros" cronometrava `total < 300ms` para um item de 200ms. Sob disputa o timer acorda tarde — medido a 303, 306, 343 e 352ms. Pior: o limite folgado ainda **aprovava** uma implementação em lotes, que sai em ~220ms; ou seja, ele falhava sozinho e não pegava a regressão que dizia pegar.
  - Agora a prova é de **sobreposição, não de duração**: o item lento fica preso numa promise que o teste controla, e o caso exige que os cinco rápidos tenham COMEÇADO enquanto ele ainda está em voo. Sem timer nenhum, roda em 2ms em vez de 350ms, e foi verificado que ele acusa: trocando a piscina por lotes de propósito, sai "os rápidos ficaram presos ao lento em vez de reaproveitar a posição livre".
  - **Causa 2, e essa é do runner do Node:** `Unable to deserialize cloned data`, dentro do `#processRawBuffer` do próprio `node:internal/test_runner`. O canal entre o runner e cada processo filho é binário, e todo filho ainda despejava nele o banner do dotenv (`◇ injecting env (21) from .env // tip: …`, com dica sorteada e caracteres multibyte). Não dá para consertar o parser daqui, mas dá para parar de alimentar o problema: os nove `require('dotenv').config()` viraram `config({ quiet: true })` — a própria dica do dotenv sugere isso.
  - Depois das duas: **14 rodadas seguidas em concorrência 32, sem falha**. Não é prova de que a segunda causa morreu — ela é do runner e depende de tempo —, é a frequência caindo de 4 em 6 para nenhuma em 14.

- **`+HD` deixou de tirar a estrela das mãos da API.** [`mods.js`](src/mods.js), [`pp.js`](src/pp.js)
  - O `getAdjustedStars` usa o valor publicado pela API quando não há mod de dificuldade, porque ele é mais exato que o nosso — o rosu-pp está dois reworks atrás do osu!. A guarda só ignorava o CL, então **qualquer** mod cosmético mandava o cálculo para cá: um `+HD` de mapa ranqueado saía com 8.09★ onde o site publica 8.60★. É a combinação mais comum que existe, e a estrela agora aparece no título do embed.
  - A lista virou "mods que MEXEM no mapa": HD, NF, SO, SD, PF e CL ficam de fora; EZ, HR, DT, NC, HT, FL e o RX (que troca o motor inteiro) continuam pedindo cálculo local.

- **O pp de FC só entra quando é maior que o da play.** [`embeds/play.js`](src/embeds/play.js)
  - Em choke de um combo só, o valor que calculamos para o FC sai **abaixo** do pp oficial do servidor — os dois motores discordam, e o nosso é o desatualizado. Exibir os dois dizia "se tivesse acertado tudo, teria ganhado menos", que não é o que a linha significa. Visto no top play #1 do mrekk: 1857.11pp reais contra 1846.98pp de "FC".

---

# Sessão de 2026-08-14

Sessão de análise de desempenho, e depois dos dois itens de maior efeito que ela apontou. As medições saíram da própria máquina, com os `.osu` reais que já estavam no `cache.db`.

## ⚡ Desempenho

- **O PP de FC passou a ter cache.** [`db.js`](src/db.js), [`pp.js`](src/pp.js)
  - A `map_difficulty` já poupava o cálculo das **estrelas** desde que ele saiu do POST em `/beatmaps/{id}/attributes`. O do **FC pp** continuava sendo refeito do zero a cada exibição: `getFCpp` não consultava cache nenhum, então parse do `.osu`, atributos de dificuldade e performance rodavam de novo para um número que não muda.
  - Medido nos 12 maiores `.osu` do cache: **1,54ms de parse + 4,28ms de dificuldade + 0,34ms de performance por play** — ~30ms de event loop parado por página de `/topplays`, em toda renderização, inclusive num mapa já calculado mil vezes antes. O `paginate` memoiza o embed, então voltar uma página não pagava; a próxima pessoa a consultar o mesmo mapa pagava tudo.
  - Ponta a ponta, contra uma cópia do `cache.db` real: **36,7ms → 0,07ms** na segunda chamada (o primeiro número inclui a inicialização do Wasm, paga uma vez por processo; em regime o custo evitado é os ~6ms acima).
  - **A chave é o que precisava de cuidado.** O número é função pura de quatro coisas — arquivo do mapa, mods, motor e a distribuição de acertos que o FC teria —, e nenhuma delas depende de *qual* score é. Por isso a chave soma os misses ao `n300`: é exatamente o que os dois motores fazem antes de calcular (`perfParams.n300 = n300 + misses` no rosu, `calc_kwargs["n300"] = n300 + nmiss` no `pp_calc.py`). Um score com 3 misses e outro com nenhum, mesmo total de objetos acertados, têm o mesmo FC pela frente e dividem a entrada — verificado: os dois saem com o mesmo pp.
  - O `engine` entra na chave porque os motores dão números diferentes de propósito (rosu-pp no algoritmo oficial, akatsuki-pp no Relax), e a mecânica lazer/stable separa o rosu em dois. Uma chave sem essa dimensão serviria número de Bancho num servidor RX, e nada na tela denunciaria: sai um pp plausível.
  - Score sem os três acertos informados **não** é cacheado: é o ramo que cai na accuracy bruta, um float que não serve de chave — e é justamente o caso em que o resultado é o menos confiável.
  - Falha não é gravada. Uma queda de rede ou um Python ausente são passageiros, e guardá-los transformaria "falhou uma vez" em "falha para sempre" naquele mapa.
  - Teto próprio (`FC_PP_CACHE_MAX`, padrão 20000 ≈ 1–2MB): ao contrário das outras duas tabelas de cache, esta cresce por **score** e não por mapa, então sem teto ela só aumenta. A evicção é por idade de inserção — aqui a leitura não escreve nada, então não há marca de último uso, e a idade ainda limita por quanto tempo um número pode ficar desatualizado depois de um reupload. O desempate é por `rowid`: as 5 plays de uma página caem no mesmo milissegundo, e sem ele a evicção podia comer justamente a entrada recém-gravada.

- **O Python do Relax virou processo de vida longa.** [`pythonWorker.js`](src/pythonWorker.js), [`pp_calc.py`](src/pp_calc.py), [`pp.js`](src/pp.js)
  - O PP do Relax sai do `akatsuki-pp-py`, o mesmo motor dos servidores, e não tem equivalente em JavaScript. Cada número custava um `spawn`: **47,3ms por cálculo** só de subir o interpretador, medido com o transporte isolado. Uma página de `/topplays` de RX são cinco.
  - Agora o processo fica de pé e atende pedidos em sequência: **0,16ms por cálculo** depois do primeiro, ou 236ms → 0,8ms por página. (O cálculo em si custa o que sempre custou; o que sumiu foi o transporte.)
  - **O protocolo precisa carregar binário.** Uma linha de JSON com os parâmetros e o tamanho do corpo, seguida dos bytes crus do `.osu`. Do lado do Python, `read(n)` num pipe pode devolver menos do que foi pedido mesmo sem ter acabado — daí o `read_exact`, sem o qual o mapa chegaria truncado e a lib calcularia meio mapa sem reclamar de nada.
  - **Cada pedido leva um id**, porque o bot manda os cinco de uma página em voo ao mesmo tempo. Sem casar resposta com pedido, bastava uma chegar fora de ordem para uma play exibir o pp de outra — e o número sairia plausível, sem nada denunciar.
  - **Falha de um pedido não derruba o worker**: mapa problemático responde erro e a fila segue, senão um mapa puniria as outras quatro plays da página. O que derruba é falta da lib ou fluxo dessincronizado, aí o processo sai e o Node sobe outro.
  - **Instalação sem a lib ficou barata.** Antes, cada play pagava um spawn inteiro para redescobrir a mesma falha permanente. Agora um worker que morre sem ter respondido nada bloqueia novas tentativas por um minuto — e a causa continua sendo logada uma vez só. Um worker que já serviu alguma coisa é reiniciado na hora: ali a morte foi acidente, não configuração.
  - **Segurar o event loop só enquanto há pedido em voo.** Os dois extremos quebram: sempre referenciado deixaria pendurado um script que não chame `close()` (o `npm run smoke` é exatamente isso); nunca referenciado deixaria o Node sair no meio de um cálculo, sem resposta e sem erro — invisível no bot, onde o socket do gateway segura o loop, e não num script solto.
  - **Defeito encontrado e corrigido no caminho:** uma morte chega por até três caminhos (`error`, `close` e o `close()` do shutdown), e o worker recebia mais de um para o mesmo processo. Sem trava, um shutdown normal caía no relato de "morreu sozinho" — numa sessão sem nenhum cálculo de RX, o bot logava "PP do Relax indisponível" ao encerrar e ainda ligava o backoff, por causa de um encerramento que deu certo. Tem teste.
  - Os testes rodam contra o `pp_calc.py` de verdade, com um dublê da lib compilada entrando por `PYTHONPATH` — o enquadramento, a leitura exata do corpo e os ids são exercitados como em produção, sem exigir a lib instalada em quem testa. Sem Python na máquina, são pulados em vez de falhar.

- **Falha de cálculo deixa rastro, uma vez por causa.** [`logger.js`](src/logger.js), [`pp.js`](src/pp.js)
  - Cinco `catch` mudos devolviam `null` sem logar nada. Na tela isso era `?` no lugar da estrela, o `(FC: ~Xpp)` que não aparece, e o `/simulate` respondendo que não conseguiu — sem nenhuma forma de saber por quê. Ficou pior com uma camada de cache entre o cálculo e a tela.
  - O quinto era o `require` do rosu-pp: falhar ali apaga **todo** o PP de servidor vanilla, e apagava calado.
  - Logar tudo não serve: os cálculos rodam uma vez por play, então um `/topplays` de um mapa problemático viraria cinco linhas idênticas por página, repetidas a cada renderização — enchendo o disco de quem já está com problema. O `logErrorOnce` é por causa, com teto, descartando a mais antiga (que pode voltar a ser logada se reaparecer). O contexto entra na chave: o mesmo timeout no caminho das estrelas e no do FC pp são dois problemas.

- **Cache negativo de beatmap, e a lógica de TTL numa peça só.** [`ttlCache.js`](src/ttlCache.js), [`osuClient.js`](src/osuClient.js)
  - Mapa que a API oficial não conhece era pedido de novo a cada renderização — o `precisaEnriquecer` continua verdadeiro para aquele score para sempre. É o caso do mapa exclusivo de servidor privado.
  - **Só o 404 vira cache negativo.** Um 5xx ou uma queda de rede são passageiros, e guardá-los faria um blip de dez segundos esconder o mapa por dez minutos — trocando uma falha visível por dados faltando no embed.
  - Três lugares tinham a mesma lógica de TTL + teto escrita à mão, e as duas armadilhas dela custaram a mesma correção em cada cópia: que reatribuir chave no `Map` não muda a posição dela, e que o TTL sozinho não é teto. Agora é uma peça com teste próprio.

- **Piscina de posições no lugar dos lotes.** [`concurrency.js`](src/concurrency.js)
  - O `verifyMapStatus` relia as dificuldades **em série**: num set de 100, cada uma pagava o tempo de ida e volta sozinha. E o `enrichBeatmapData` usava lotes com `Promise.all`, que só terminam quando o mapa mais lento do lote termina — quatro rápidos parados esperando o quinto.
  - O `mapLimit` reaproveita a posição assim que ela vaga. Medido no teste: com um item de 200ms e cinco de 10ms em duas vagas, o total fica perto dos 200ms do próprio lento.
  - O teto não protege o rate limiter (ele já segura a vazão); protege contra empilhar centenas de requisições em voo, cada uma com o seu socket e o seu timeout.

## 🐛 Correções

- **O `npm run smoke` reprovava o Akatsuki e o Akatsuki RX.** [`test/smoke.js`](test/smoke.js)
  - Anterior a esta sessão: o Akatsuki entrou de fábrica sem ganhar entrada no mapa `PLAYERS`, então caía no `default` e procurava o `pudim2` do Daycore, que não existe lá. Os dois saíam como "jogador não encontrado" — o teste estava errado, não o adaptador.
  - Ficou escondido porque o servidor entrou junto de um monte de coisa; foi encontrado agora ao conferir que as mudanças de desempenho não tinham quebrado nada.
  - Entra por **ID**, e não por nick: nick muda, ID não — a mesma razão pela qual o link do usuário guarda o `osu_id`. Um teste ancorado em nome reprova sozinho no dia em que alguém se renomear.
  - O ID escolhido tem números **diferentes** em vanilla e em RX (medido: #4 com 23897pp contra #1 com 62115pp). No Ripple o Relax é um eixo separado do modo, lido em `stats[rx].std`; um jogador com os mesmos números nos dois deixaria uma inversão desse índice passar sem ninguém notar. Agora ela apareceria na saída do smoke.
  - Conferido de passagem que o `global_leaderboard_rank` do adaptador está certo: ele vem `null` para conta fora do leaderboard e preenchido para quem está nele — o que parecia campo errado era conta inativa.

## 🧹 Organização

- **O `db.js` virou um pacote, com as migrações carimbadas.** [`db/`](src/db)
  - Eram 1030 linhas em que o schema, seis migrações e sete assuntos de consulta se intercalavam. Agora são nove arquivos por assunto, e **a superfície não mudou**: tudo continua saindo de `require('./db')` com os mesmos 42 nomes, e os cerca de vinte pontos que chamam o banco não sabem que ele foi dividido.
  - A separação que mais importa é `schema` × `migrations`: um é o destino, o outro é o caminho de quem partiu de uma versão anterior.
  - As migrações ganharam **`user_version`**. Elas se detectam sozinhas (olham `table_info`, `sqlite_master`, flags no `meta`), o que é robusto e custa uma dezena de consultas de sondagem em todo boot, para sempre, num banco que passou por elas há muito tempo. Com o carimbo, rodam uma vez e o boot seguinte sai na primeira linha.
  - Conferido contra o `bot.db` real antes de commitar: as nove tabelas com a mesma contagem de linhas, `user_version` 0 → 1.
  - Os testes de nomeação e de desafio copiavam `src/db.js` para uma pasta temporária que imitava o layout do projeto — o que os amarrava à **lista de arquivos** do módulo, e foi o que quebrou quando o `db` virou pasta. Agora usam o `KURATANI_DATA_DIR` e os módulos de verdade.

## 🔧 Manutenção

- **`/diag`: os contadores que faltavam.** [`metrics.js`](src/metrics.js), [`commands/diag.js`](src/commands/diag.js)
  - Todo ajuste desta sessão foi medido com script de bancada — copiar o `cache.db`, cronometrar um caminho, comparar. Isso serve para **decidir** uma mudança e não serve para nada depois dela: em produção não havia como saber se o cache está acertando, se algum balde do rate limiter virou fila, ou se os motores de PP estão de pé.
  - Contadores, não histogramas: o que se quer é ordem de grandeza e proporção ("o cache de FC acerta 90%?"). O conjunto de chaves é fechado — vem do código, não de dado de usuário —, então não cresce sozinho.
  - Instrumentados os quatro caches de mapa, o de usuário, o negativo, cada balde do rate limiter (chamadas e espera acumulada) e os dois workers.
  - Exige Administrator e responde em efêmero. **Fora do `/help` de propósito**, com a razão escrita no teste que cobra o catálogo: o help responde "o que dá para fazer com este bot" para quem joga, e uma linha sobre contadores de processo ali seria ruído para todo mundo.

- **O download do `.osu` saiu do `pp.js`.** [`beatmapFile.js`](src/beatmapFile.js)
  - Não é cálculo de nada: é download com rate limiter, retry, deduplicação de pedidos em voo e cache. O que sobra no `pp.js` agora é a decisão — qual motor cada servidor usa, o que vale calcular, e onde o resultado fica guardado. De 471 para 344 linhas, com os dois motores e o download fora.

- **Registrado o que acontece se um dia houver sharding.** [`README.md`](README.md)
  - O bot roda em um processo, o que é o certo hoje: o Discord só exige sharding acima de 2500 servidores. A decisão fica registrada porque as consequências não são óbvias no dia em que ela mudar.
  - Quatro estruturas guardam estado no processo. Três degradam (mais requisições, um comando ocasionalmente sem contexto de mapa); o **rate limiter** não — um limite global aplicado localmente deixa de ser limite, e o preço é 429 na API oficial. O Redis já é dependência do projeto e resolveria.

- **`KURATANI_DATA_DIR`: onde os dados ficam.** [`paths.js`](src/paths.js)
  - Vazio (o padrão) é a raiz do projeto, que é onde `bot.db` e `cache.db` sempre estiveram — quem não define nada não vê diferença.
  - Nasceu do teste: exercitar a evicção de um cache significava **apagar o cache real** de quem roda `npm test`. Serve também para hospedagem, já que o deploy na VPS é `git pull` por cima do diretório do projeto.
  - Vale para todo dado, inclusive os JSON das versões antigas que as migrações procuram — uma regra só em vez de metade num lugar e metade no outro. `ASSETS` fica de fora: emoji é conteúdo que viaja junto do código.

## 📋 Levantamento

O levantamento de desempenho e escalabilidade que abriu a sessão tinha onze itens. Todos foram aplicados, exceto um que a medição derrubou:

**Medido e descartado:** todo método do `db.js` chama `db.prepare(...)` a cada invocação, o que costuma ser apontado como desperdício. São **4,8µs contra 1,0µs** de um statement reusado — fator 4,9x, valor absoluto irrelevante com algumas dezenas de consultas por comando. Não vale trocar legibilidade por isso; fica registrado para o argumento não voltar sem o número.

---

# Sessão de 2026-08-13

Primeira sessão com acesso ao servidor de verdade. Os comandos administrativos, escritos em 08/08 e nunca testados contra um bancho.py real, foram exercitados em produção — e foi isso que expôs quase tudo que está aqui.

## ✨ Novos recursos

- **Terceiro tipo de servidor: Ripple/Hanayo, com o Akatsuki de fábrica.** [`osu/rippleApi.js`](src/osu/rippleApi.js), [`servers.js`](src/servers.js)
  - O bot falava `official` e `banchopy`. O Akatsuki roda **Ripple**, e não tem nada em comum além de servir osu!: a API é toda em `<site>/api/v1`, no mesmo host — a convenção `api.<domínio>` do bancho.py **nem resolve DNS** lá. Nenhuma linha de `.env` faria o adaptador existente falar aquele protocolo.
  - A arquitetura já previa: o `osuClient` despacha por `kind` e o contrato são seis funções. O trabalho foi escrever o adaptador e as duas traduções — usuário e score.
  - **Relax deixou de ser um "modo de jogo".** No bancho.py, Relax é o modo 4, no mesmo campo de osu!/taiko/catch/mania. No Ripple são dois eixos independentes: `mode` (0-3) e `rx` (0 vanilla, 1 relax, 2 autopilot). O registro passou a carregar `rx` separado do `gameMode`, e cada tipo diz como pede o seu — antes o `relaxVariant` fixava `gameMode: 4`, que só valia para uma das duas stacks.
  - **O `/score` precisou de um segundo formato.** O `/api/v1/scores?b=` devolve o leaderboard do MAPA e não aceita filtro por jogador: testados `userid`, `user_id`, `id` e `name`, todos devolvem os mesmos 50 primeiros colocados. Usá-lo faria o comando mostrar o score de outra pessoa como se fosse o de quem perguntou. O `/api/get_scores`, no formato legado da API v1 do osu!, filtra de verdade — o preço é traduzir campos como string, `enabled_mods` no lugar de `mods`, e calcular a acurácia, que aquele formato não manda.
  - O Akatsuki vem **de fábrica**, como o osu! oficial, por ser grande e ter API pública estável. Diferente do oficial, dá para desligar: `BUILTIN_SERVERS=` vazio, ou uma lista sem ele — quem hospeda o bot para outro servidor não fica carregando um concorrente na lista de escolhas.

- **`/wipe`: apaga os scores de uma conta num modo.** [`commands/wipe.js`](src/commands/wipe.js), [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - Publica no canal `wipe`, que o bancho já escutava. É o **único comando irreversível do bot**: o `wipe_user` faz `DELETE FROM scores`, zera a linha de `stats` e tira o jogador dos sorted sets de leaderboard no Redis. Não há soft-delete nem cópia.
  - **E o bancho não confere privilégio nesse canal.** O `restrict` recusa sozinho quem não é `DEVELOPER` mexendo em staff; o `wipe_user` só checa se o alvo existe. Nos outros comandos o servidor é uma segunda tranca — aqui não existe segunda tranca, e o que o bot decidir é o que acontece. Daí três travas que os outros não têm: exige `DEVELOPER` (o privilégio mais alto, e o único proporcional a uma ação sem volta que o servidor não filtra); confirmação por botão com os números que serão destruídos na tela, com janela de 60s; e o log de auditoria guardando esses números, porque depois do wipe eles não existem em lugar nenhum.
  - O modo é obrigatório e sem padrão — o wipe age sobre **um** modo, e escolher por omissão seria apagar o que ninguém pediu.
  - Validado em produção pelo dono do servidor: um teste no-op num modo zerado, e um real (10307pp e 7 plays apagados, confirmado pela releitura).

- **`/nominate` aceita mapa que o servidor ainda não conhece.** [`commands/nominate.js`](src/commands/nominate.js), [`osu/officialApi.js`](src/osu/officialApi.js)
  - O `resolveSet` pedia as dificuldades ao servidor administrado e desistia com "mapa não encontrado" quando ele não tinha o mapa no banco — que é o caso **comum** de mapa novo, o que ninguém no servidor jogou ainda.
  - Só que o bancho é menos exigente do que o bot era: ao receber o publish no canal `rank` ele chama `Beatmap.from_bid`, que resolve em três degraus (cache → banco → **API do osu!**) e cacheia o set inteiro quando não conhece o mapa. A recusa negava uma nomeação que o servidor daria conta de aplicar.
  - Agora o servidor continua tendo prioridade e a API oficial entra só como fallback, tanto para descobrir de qual set é uma dificuldade quanto para listar as dificuldades de um set. A resposta avisa quando a lista veio do osu!, já que aí a contagem de dificuldades não é do servidor.
  - De quebra, 404 do `getServerMap` deixou de virar exceção: ID de dificuldade solto que o servidor não conhecia caía no catch geral e respondia "ocorreu um erro" em vez da mensagem certa.

- **Mapa rankeado DENTRO DO JOGO também vira anúncio.** [`daycoreEvents.js`](src/daycoreEvents.js), [`announce.js`](src/announce.js)
  - O bancho já publicava em `ex:map_status_change` a cada `!map rank/unrank/love`, com os IDs afetados e o tipo. **Ninguém assinava o canal**, então o evento existia e se perdia: mapa rankeado in-game não aparecia em lugar nenhum do Discord, só o que passava pelo `/nominate`.
  - Não há duplicação. O caminho do bot publica no canal `rank`, e o `change_bm_status` que o atende **não** publica o `ex:map_status_change` — as duas fontes não se cruzam, uma completa a outra.
  - Só `rank` e `love` viram anúncio. `unrank` fica de fora por decisão de produto: desqualificar é rotina de curadoria e encheria o canal sem informar ninguém — quem acompanha quer saber o que **entrou**.
  - A assinatura usa conexão própria: um client em modo subscribe não aceita outros comandos, então não pode dividir a conexão que o `daycoreAdmin` usa para publicar. E ao contrário do publisher, aqui a reconexão é infinita (com teto de 30s): é uma assinatura de vida longa, e desistir dela deixaria o bot mudo para sempre sem ninguém perceber.
  - **Uma linha no servidor**, aplicada com autorização do dono: o publish passou a incluir `author_id` e `author_name`, senão o anúncio in-game sairia sem dizer quem aplicou. Os campos são opcionais do lado do bot — sem eles a linha vira "Aplicado pelo jogo" em vez de o anúncio sair errado ou não sair. A linha do embed distingue as duas origens, porque aplicado pelo bot é rastreável até uma conta do Discord e aplicado no jogo não é.
  - **Registro de um erro de investigação:** a conclusão inicial foi de que o `!map` não publicava nada, e daí saíram duas propostas ruins — varrer ~3800 mapas por ciclo, ou pedir ao dono do servidor que construísse o evento. As duas eram desnecessárias. O `grep publish` não achou porque o código chama `execute_command("PUBLISH", ...)`, em **maiúsculo**. O mesmo motivo pelo qual o canal não aparecia num `PUBSUB CHANNELS`: aquele comando lista canais com assinante **ativo**, e ninguém assinava.

- **Anúncio de mudança de status no Discord.** [`announce.js`](src/announce.js)
  - O bancho.py-ex não avisa o Discord quando um mapa é rankeado ou amado: quem acompanha só descobre entrando no site. O bot já sabe da mudança — é ele que publica e confirma —, então anunciar é aproveitar o que já está em mãos.
  - Sai no canal de `DAYCORE_ANNOUNCE_CHANNEL_ID`, com capa do set, link para a página do mapa **no servidor**, quantas dificuldades pegaram e quem aplicou. Cobre os três caminhos que mudam status: nomeação atingindo o limiar, `force` e `disqualify`.
  - **Vazio desliga.** Falhar fechado importa mais aqui que no resto do bot: o alvo é um canal público, e configuração errada não deixa de anunciar — ela anuncia no lugar errado.
  - Só anuncia com pelo menos uma dificuldade confirmada, e o envio não é aguardado pela resposta do comando: o anúncio não faz parte do contrato dele, e a API do Discord lenta atrasaria quem rodou por causa de uma mensagem para outro canal.

## 🔒 Segurança

- **`/staff register` exigia apenas Administrator no Discord — e isso era uma escalada de privilégio.** [`commands/staff.js`](src/commands/staff.js), [`db.js`](src/db.js)
  - Bastava ter Administrator no Discord para apontar o próprio Discord ao nick de outro staff e herdar o privilégio dele. Não é hipótese: foi feito nesta sessão, às 14:16, para testar o `restrict`.
  - Enquanto o pior caso era uma restrição reversível, a assinatura no motivo (`signReason`) bastava como mitigação — dava para agir em nome de outro, mas não sem rastro. Com o `/wipe` no outro extremo, a cadeia virou "Administrator no Discord → conta Developer → perda permanente de dados", e deixou de bastar.
  - Agora são dois passos, e quem cria o vínculo é o segundo: o `register` só **emite um código**, e o `/staff confirm` — rodado pela própria pessoa, sem exigir Administrator — cria o vínculo depois de achar o código no perfil daquela conta de jogo. As duas pontas ficam provadas: o código prova a posse da conta, e rodar o confirm prova o controle do Discord.
  - **Aval, para o caminho legítimo não emperrar:** quem já provou a própria conta **e** é `DEVELOPER` no jogo vincula direto. Um Developer já tem controle total do servidor — o código nunca protegeu contra ele. O que a escalada usava era Administrator no Discord *sem* privilégio no jogo, e esse continua sem conseguir avalizar ninguém.
  - A coluna `proof` guarda como cada vínculo foi estabelecido, e a diferença decide quem avaliza: `self` (provado, único que avaliza), `vouch` (afirmado por um Developer provado — não avaliza, senão uma afirmação viraria poder de afirmar, em cadeia) e `NULL` (anterior à prova existir; vale, mas não avaliza, senão quem tivesse explorado o furo seguiria com o poder que ele dava).

- **Uma conta de jogo por vínculo.** [`db.js`](src/db.js), [`commands/staff.js`](src/commands/staff.js)
  - A PK de `staff_links` é o `discord_id`, então o schema só garantia um osu! por Discord — nada impedia o contrário. Em produção isso produziu **duas contas do Discord vinculadas à mesma conta de staff ao mesmo tempo**: duas identidades agindo como a mesma pessoa no log de auditoria do servidor.
  - Para nomeação não era problema (a PK de `map_nominations` é por `osu_id`, então não vira voto duplo), mas para moderação a auditoria do servidor deixava de saber quem agiu. O `register` agora recusa em vez de sobrescrever, e o `/staff list` marca `osu_id` repetido — vínculos anteriores à checagem continuam no banco, e uma lista que só enfileira linhas não os denuncia.

- **Comando que responde em ephemeral saiu do modo texto.** [`prefix/spec.js`](src/prefix/spec.js), [`commands/moderate.js`](src/commands/moderate.js), [`commands/staff.js`](src/commands/staff.js), [`commands/wipe.js`](src/commands/wipe.js)
  - Ephemeral só existe dentro de interação, então o adaptador do prefixo precisa tirar a flag — e a resposta que só o autor veria virava mensagem no canal. Um `k!moderate log` num canal público despejaria alvos e motivos de moderação; `k!staff list` diria quem no Discord é quem no jogo.
  - Não era escalada: as travas de privilégio sempre valeram, e quem não é staff continuava recusado. Era vazamento por troca de canal. O comando agora declara `prefix.slashOnly` e o `buildSpec` o deixa de fora, reaproveitando o aviso de boot que já existia.

## 🐛 Correções de bugs

- **A fila de nomeação era apagada mesmo quando nada foi aplicado.** [`commands/nominate.js`](src/commands/nominate.js)
  - `clearNominations` era incondicional depois de aplicar. Em 09/08 um `0/100 ok` apagou as nomeações sem que uma única dificuldade tivesse mudado no servidor. Com limiar 1 o custo é renomear; com limiar maior, uma queda transitória destrói os votos acumulados de várias pessoas.
  - Agora só limpa com `pending.length === 0`. Em sucesso parcial a fila sobrevive e o set continua no `/nominate queue` — reexecutar é idempotente, recuperar voto perdido não é.

- **Publicação parcial não deixava rastro de auditoria.** [`commands/nominate.js`](src/commands/nominate.js)
  - Uma falha no meio do laço de publicação virava exceção, o comando respondia "ocorreu um erro" e o `logAdminAction` nunca rodava. Só que o que já tinha sido publicado **não é desfeito** — o bancho consome do Redis por conta própria e aplica. O servidor mudava e a auditoria do bot não registrava nada, que é o oposto do que ela existe para garantir.
  - O `applyStatus` agora devolve o que saiu e a falha; o registro sai sempre, e a resposta distingue "não confirmou" (pode ser o bancho ainda processando) de "nem chegou a ser publicado" (certeza de que não vai mudar sozinho).

- **A janela de verificação não crescia com o set.** [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - Eram três releituras de 1,2s para qualquer set. O trabalho do bancho, porém, é proporcional ao número de dificuldades — ele baixa o `.osu` de cada uma que não tem em disco. Ao rankear um set de 100 o comando reportou `90/100`, e a releitura seguinte mostrou `100/100`: nada tinha falhado, e mesmo assim a resposta chamou de parcial uma ação que deu certo inteira — justo na função que existe para não mentir sobre o resultado.
  - Agora o laço roda até confirmar tudo ou a janela fechar, com orçamento de 4s + 900ms por dificuldade e teto de 3min. O teto é porque quem espera do outro lado é uma interação do Discord, que expira.

- **O log de erro tinha deixado de dizer onde quebrou.** [`logger.js`](src/logger.js)
  - O módulo nasceu para não imprimir o `AxiosError` cru, que carrega `.config` com o header `Authorization`. Acertou nisso e corrigiu demais: para erro que não é HTTP sobrava só `error.message`, então um `TypeError` dentro de um comando virava uma linha sem arquivo, sem função e sem linha — impossível de depurar em produção.
  - O stack passou a acompanhar quando **não** houve resposta HTTP, que é onde ele importa. Um 404 da API continua uma linha só. O `.config` segue fora, com teste para não regredir.

- **Clique concorrente na paginação revertia o cursor.** [`pagination.js`](src/pagination.js)
  - O coletor não espera um handler terminar para entregar o próximo, e montar uma página faz rede e cálculo de PP — dois cliques seguidos rodam em paralelo. O handler que falhava fazia `page = shown` com o valor que **ele** tinha visto, desfazendo o avanço de um clique posterior bem-sucedido, e o clique seguinte partia do lugar errado.
  - Um contador diz qual clique ainda manda: quem ficou para trás não pinta a tela nem mexe no cursor.

- **`/moderate restrict` contra outro staff falhava em silêncio.** [`commands/moderate.js`](src/commands/moderate.js), [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - O `staffGuard` exige `ADMINISTRATOR`, mas o bancho exige `DEVELOPER` para mexer em quem é staff. Como pub/sub não responde ao publisher, a recusa dele não chegava a lugar nenhum: o bot publicava, o servidor ignorava, e a única pista era um "NÃO confirmado" seco — quem tentasse concluiria que o bot está quebrado.
  - A regra agora é espelhada antes de publicar. O detalhe que exigiu função nova: `STAFF = MODERATOR | ADMINISTRATOR | DEVELOPER` é **máscara**, e o bancho testa `priv & STAFF` — qualquer um dos bits basta. O `hasPriv` do bot exige o conjunto inteiro, de propósito, então passar a máscara por lá deixaria o Moderator puro desprotegido: exatamente o cargo mais baixo dos três.

- **Um arquivo solto em `commands/` derrubava o boot.** [`index.js`](src/index.js)
  - O laço ia direto em `command.data.name`. Um helper `.js` naquela pasta, ou um comando com erro de sintaxe, matava o processo **antes** do login — sob supervisor isso não aparece como falha, aparece como loop de restart, e o bot fica fora do ar até alguém ler o log. Agora o arquivo ruim é ignorado com aviso.

- **Score de servidor que manda o combo ficava sem estrelas.** [`osuClient.js`](src/osuClient.js)
  - O `enrichBeatmapData` buscava os metadados oficiais só quando faltava `max_combo`. O Ripple manda o combo no próprio score e nenhuma dificuldade, então o enriquecimento era pulado e o `difficulty_rating` ficava em zero — o embed saía com `?★` no lugar do número. A condição passou a olhar os dois campos.

- **Guarda de `pp` não pegava NaN.** [`pp.js`](src/pp.js), [`scorePP.js`](src/scorePP.js), [`commands/recent.js`](src/commands/recent.js), [`commands/score.js`](src/commands/score.js), [`commands/simulate.js`](src/commands/simulate.js)
  - Todos os sites usavam `pp == null`, e `NaN == null` é falso — então um NaN passava direto e `NaN.toFixed(2)` imprimia **"NaN pp"** no embed, pior que `?pp` porque parece resultado. O `typeof data.pp === 'number'` do caminho do Python deixava passar igual, já que `typeof NaN` é `'number'`.

- **O registro de falhas do Python crescia sem teto.** [`pp.js`](src/pp.js)
  - Guardava cada mensagem de stderr distinta para não repetir log, e nunca descartava nada — bastava a mensagem variar por mapa para virar uma entrada de até 2000 caracteres por mapa que falhou, num processo que fica semanas no ar. Mesmo cuidado que o `mapContext` e o `cooldowns` já tomavam.

## ⚠️ Descoberto sobre o servidor

- **O `userpage_content` da API v2 não é onde o perfil acaba parando.** [`osu/banchoPyApi.js`](src/osu/banchoPyApi.js)
  - O bancho declara a coluna, o `READ_PARAMS` a inclui e o `fetch_one` faz `select(*READ_PARAMS)` — tudo aponta para ela ser o campo certo. E ela vem `null` mesmo com o perfil preenchido e visível no site.
  - Não é cache (mudança de `priv` feita no mesmo dia aparece na API) nem base separada (bancho e Shiina-Web apontam para a mesma `bancho`). Quem grava o userpage é o Shiina-Web, e ele guarda noutro lugar da mesma base.
  - O desafio de posse passou a procurar o código em duas fontes: o campo da API, que continua sendo o caminho certo e mais barato se um dia passarem a escrever nele, e a **página pública renderizada**, que é o que hoje reflete o que a pessoa salvou. Procurar a string na página inteira é robusto de propósito — não depende de classe de CSS nem de estrutura, e o código tem entropia suficiente para casar por acaso ser desprezível.

- **Os `restrict` de 08/08 e os `rank` de 09/08 falhavam por causa do servidor, não do bot.** Toda a stack (`bancho`, `redis`, `mysql`, `shiina`) foi recriada em 09/08 às 21:53 — os quatro contêineres criados dentro de 100ms um do outro. Tudo que falhou aconteceu antes disso; tudo depois funcionou. O bot publicava e reportava honestamente "não confirmado" o tempo todo.

## 🧪 Testes

- De 167 para **270 casos**. Cobrem, entre outros: o fallback do `/nominate` para mapa fora do servidor, a janela de verificação proporcional, a publicação parcial, o desafio de posse e o aval, o alfabeto e a entropia do código, a máscara `STAFF`, o `slashOnly`, e o teto do registro de falhas do Python.
- Nos casos da paginação e do teto de falhas, o teste novo foi rodado **contra a versão anterior do módulo** para confirmar que reprova o código antigo e passa no atual — um teste que passa nos dois não estaria testando a correção.
- O fixture das travas genéricas do prefixo (opção de usuário, escopo de servidor, permissão exigida) deixou de ser o `/staff`: aquilo testa o dispatcher, e não devia depender de qual comando real por acaso tem as três propriedades.

---

# Sessão de 2026-08-12

## ✨ Novos recursos

- **Dois atalhos novos: `/osu` e `/top`.** [`commands/osu.js`](src/commands/osu.js), [`commands/top.js`](src/commands/top.js)
  - Os nomes que a galera já digita por reflexo, agora apontando para o `/profile` e o `/topplays`.
  - Mesmo desenho dos quatro que já existiam: o arquivo reaproveita o `toJSON()` do original em vez de redeclarar as opções, então mudar a descrição do `server` no comando de origem continua chegando aqui sozinho. Valem para o modo texto também (`k!osu`, `k!top`), que sai de graça pelo dispatcher.
  - O `/top` herda a paginação do `/topplays` sem ressalva: o coletor é criado sobre a mensagem, então o `id` dos botões é só prefixo de `customId` ali dentro e não colide com o comando de origem.
  - Cooldown é por nome digitado, então cada atalho tem balde próprio — como já acontece com `/rs`, `/c`, `/choke` e `/wi`.

- **`/help`, o índice que faltava.** [`commands/help.js`](src/commands/help.js)
  - Até aqui a única forma de descobrir o bot era o menu do Discord, que lista os comandos achatados e com os atalhos ao lado dos originais. O `/help` agrupa em **Perfil e plays**, **PP e simulações** e **Configuração**, com os atalhos ao lado do comando que eles chamam — `/recent` (`/rs`) — em vez de ocupando linha própria.
  - A lista é **curada, não derivada** do `client.commands`: derivar traria os seis aliases e os três administrativos, dobrando o tamanho da resposta sem ajudar quem chegou agora. Mas os nomes são conferidos contra o registro antes de virar linha, então um comando removido some do help em vez de virar uma linha morta.
  - Mostra também **os servidores configurados com as chaves que a opção `server` aceita** (`Bancho` `official`, `Daycore` `daycore`...) — justamente a parte que muda de instalação para instalação e não cabe no README de ninguém. Vem de `servers.choices()`, a mesma lista que os comandos oferecem, então não tem como divergir do que é aceito de verdade.
  - Os administrativos (`/nominate`, `/moderate`, `/staff`) só aparecem dentro do Discord do `DAYCORE_GUILD_ID`, onde de fato funcionam. Fora dele o `staffGuard` recusaria tudo, e listá-los seria oferecer o que não dá para usar.
  - Resposta **pública, não ephemeral**: help é o tipo de coisa que se manda no canal para outra pessoa ler. Também mantém os dois modos iguais, já que o adaptador do prefixo descarta a flag de ephemeral. Sem opções, o `k!help` sai de graça pelo `buildSpec`.

- **O prefixo sozinho deixou de ser um beco sem saída.** [`prefixCommands.js`](src/prefixCommands.js)
  - Quem descobria o bot e mandava `k!` para ver o que acontecia recebia silêncio. Agora responde com por onde começar (`/link set`, os três comandos mais usados) e aponta o `/help`.
  - **A exceção é o prefixo exato, não tudo que começa com ele.** `k!qualquercoisa` segue calado, e por um motivo que não mudou: ali o texto pode ser qualquer frase que por acaso comece com o prefixo, e responder a cada uma viraria ruído no canal. O teste guarda os dois lados.
  - Divide o balde de cooldown com o `/help`, e **em cooldown fica em silêncio** em vez de responder "espere Xs" — ninguém pediu para executar nada.

- **PP de play que o servidor não pontua.** [`scorePP.js`](src/scorePP.js), [`commands/recent.js`](src/commands/recent.js), [`pp.js`](src/pp.js)
  - A API devolve `pp` nulo em três situações bem diferentes, e as três viravam `0pp` — o que mentia em duas. O caso que expôs isso: uma play num mapa **graveyard** aparecia como `0pp` com um `(FC: ~634pp)` ao lado, sugerindo que um FC pagaria 634 quando pagaria zero igual.
  - Confirmado que **a API do osu! não expõe pp hipotético**: o `POST /beatmaps/{id}/attributes` devolve `star_rating` e os fatores de dificuldade, nunca performance. Mas o `.osu` é público para qualquer mapa e o motor de pp já roda aqui — então o valor existe, e sai com `~` na frente para não passar por número oficial.
  - **Play não terminada depende de um parâmetro que a lib sempre teve e o bot nunca usou.** Sem `passedObjects`, uma desistência é avaliada contra o mapa **inteiro**: a lib inventa um 300 para cada objeto que a pessoa nunca viu, e o combo deixa de fazer diferença. Medido numa desistência aos 120 de 1833 objetos: **332.6pp sem, 101.3pp com** — as estrelas caem de 7.08 para 5.44 e o combo máximo de 1833 para 184.
  - No Relax o cálculo parcial devolve `null` em vez de um número: o akatsuki-pp trabalha sempre com o mapa inteiro, e dar o valor cheio para uma play interrompida seria inventar.
  - O cálculo virou o `scorePP.js`, compartilhado: era a mesma conta em dois comandos, e as cópias tinham divergido no pior sentido — o `/score` calculava, o `/recent` imprimia zero.

- **O formato novo de score da API, e o mod CL que vinha com ele.** [`osu/officialApi.js`](src/osu/officialApi.js), [`mods.js`](src/mods.js)
  - O `shouldUseLazer` já decidia a mecânica de cálculo pela presença do mod `CL`, e estava certo desde sempre. Só que **o formato antigo da API não manda o CL**, então a condição nunca era verdadeira: todo score do Bancho era calculado com mecânica de lazer, inclusive os de stable, que hoje são quase todos.
  - Com `x-api-version` o CL chega. E a diferença aparece onde dói: em modo lazer o rosu-pp **não aplica penalidade por combo**, porque lá a quebra vem dos slider ends registrados e não de estimativa. Scores com combo quebrado saíam muito acima do real — medido em 8 deles contra o pp oficial: **18,9% de erro médio, agora 7,0%**. O resíduo é o rosu estar dois reworks atrás, não isto.
  - Vieram junto as estatísticas de lazer de verdade para quem joga no lazer (a acurácia de uma play do `/recent` passou de 95,28% para os 95,46% corretos — o formato antigo converte para acurácia clássica).
  - **O CL é exibido nos scores**: é o único sinal de como a play foi jogada — presente quer dizer mecânica clássica (stable, ou lazer com Classic), ausente quer dizer lazer de verdade. Fica de fora só de duas decisões, e por não ser mod de **dificuldade**: no `getAdjustedStars`, contá-lo faria um score sem mod nenhum deixar de ser "sem mods" e o bot calcular estrelas localmente em vez de usar o valor da API (7.08★ contra os 7.13★ do site); e no `/simulate`, onde a simulação já é sempre stable.
  - A tradução fica na borda, num `normalizeScore`, e não espalhada pelos comandos — mesmo desenho dos adaptadores de bancho.py. **Atenção ao formato novo: ele é esparso**, o que vale zero não vem, e um FC sem tratamento viraria `undefined` misses. O header vai só nas três chamadas de score: fixar versão de formato é um contrato, e quanto menos endpoints presos a ela, menos coisa quebra na próxima.

- **`/simulate` assume mecânica stable, e a opção `combo` voltou a funcionar.** [`simulate.js`](src/commands/simulate.js), [`pp.js`](src/pp.js)
  - Uma play hipotética não tem mod CL para consultar, então o `shouldUseLazer` concluía "lazer" — e em modo lazer o rosu-pp não aplica penalidade por combo. Resultado: a opção `combo` do comando não mudava o número. Agora o comando força stable, que é o que praticamente todo mundo joga. No bancho.py já era assim.
  - **Ressalva que vale registrar**: no stable o combo é aplicado, mas **limitado por `n100 + n50 + misses`** — e isso é a fórmula do osu!, não defeito da lib. Quebra de combo sem miss é sliderbreak, que o stable não registra, então a estimativa não pode passar do número de julgamentos que não foram 300. Com `miss:5` e nenhum 100 o teto iguala os misses e o combo realmente não muda nada; com 100s na conta, muda bastante — de 1227pp a combo cheio para 623pp a 50x.

- **Rodapé e notação de mods.** [`i18n/`](src/i18n/), [`mods.js`](src/mods.js)
  - O rodapé passou a dizer **o que o mapa é**, em vez de a linha de PP explicar em texto o que aquele número não é: `Play 1/50 • osu • graveyard • Bancho • 12/08/2026, 15:59:20`. O status vale para os cinco scores de uma página do `/score`, então repetir por linha era errado — e agora aparece **sempre**, não só quando o mapa não paga pp.
  - A data foi para o fim (estava espremida no meio, com um `|` que destoava dos `•`) e a palavra "Modo" saiu: `Modo: osu` dizia duas vezes a mesma coisa, e o bot atende **só osu!standard** — o ruleset está fixo na URL da API, o `mode` é literal `'osu'` nos dois normalizadores e o `pp.js` não tem tratamento de ruleset nenhum. No dia em que atender outro, o valor vira `osu!taiko` / `osu!catch` / `osu!mania`, que já se explicam sozinhos.
  - Sem mods virou **`+NM`**. O caso vazio estava escrito quatro vezes e os quatro discordavam: o `/recent` dizia `No Mods` (texto cravado), o `/score` também mas por chave de i18n, o `/simulate` dizia `Nenhum` e o `/topplays` não mostrava **nada**. Todos passam por um `formatMods` agora.
  - No bancho.py o rodapé sai sem o status: aquele adaptador não manda o campo, e inventar seria pior.

- **`EXIT_ON_UNCAUGHT`: a escolha em falha grave passou a ser de quem hospeda.** [`index.js`](src/index.js)
  - O handler de `uncaughtException` logava e seguia rodando, com um comentário admitindo que o certo seria `process.exit(1)` e que só não era por não haver supervisor. Os dois lados têm razão, e qual vale depende de algo que o código não sabe: se existe alguém para reiniciar.
  - O padrão não mudou. Com systemd/pm2/Docker configurado, `EXIT_ON_UNCAUGHT=true` faz o processo sair para voltar limpo. Importa mais aqui do que na média dos bots: este publica ações administrativas num servidor de jogo.

## 🐛 Correções de bugs

- **O `/whatif` dizia que uma play boa faria você PERDER pp.** [`whatif.js`](src/commands/whatif.js)
  - Com 5860.19pp, simular uma play de 500pp respondia "mudaria em **+227.65pp**, indo para **5651.20pp**" — um total 200pp **abaixo** do atual, e incoerente com o `/pp`, que pedia só 412pp para chegar a 6000.
  - O ganho sempre esteve certo: é uma diferença, e o que faltava se cancela nela. O erro estava no total, que saía do `calcWeightedPP` — a soma das top 100 ponderadas, sem o bônus por playcount nem a cauda das plays além da centésima. Medido na conta que reportou: **436.64pp** ficavam de fora.
  - O `/pp` já resolvia isso do outro lado (`bonus = currentPP - currentWeighted`, subtraído do alvo antes da busca binária); o `/whatif` nunca somou de volta. Agora os dois concordam: uma play de 412.16pp responde **6000.00** nos dois.

- **Dois 404 que significavam "não tem nada aqui" eram tratados como falha.** [`osu/officialApi.js`](src/osu/officialApi.js)
  - **Jogador inexistente**: o contrato do `osuClient` promete `fetchUser → usuário ou null`, e era o que o adaptador bancho.py fazia. O oficial deixava o axios lançar, então o `if (!user)` dos comandos **nunca rodava no Bancho** — quem errava o nick no `/link set` lia *"ocorreu um erro"* em vez de *"jogador não encontrado"*, e o `/score` respondia *"erro ao buscar os scores"*.
  - **Mapa sem placar**: o endpoint de scores responde 404 tanto para mapa inexistente quanto para graveyard. Medido: `ranked/loved` → 200 com lista; `graveyard` → 404; `inexistente` → 404, a mesma mensagem. O `/score` num mapa graveyard dizia *"Erro ao buscar os scores desse mapa"* enquanto o `/recent` exibia a play daquele mesmo mapa numa boa. Agora devolve lista vazia e a resposta vira *"fulano não tem score neste mapa"*.
  - O 500 continua subindo nos dois casos — engolir esconderia indisponibilidade da API atrás de uma resposta que parece normal.

- **`play_time` numérico derrubava a página inteira do `/topplays` e do `/recent`.** [`osu/banchoPyApi.js`](src/osu/banchoPyApi.js)
  - A expressão testava o valor convertido (`String(raw).includes('T')`) e convertia o valor cru (`raw.replace(...)`): um epoch numérico estourava com *"replace is not a function"*. O `String()` só no teste era o sinal de que o tipo já era incerto ali.
  - O estrago passava do score: o `catch` do `enrichScores` chama a mesma normalização de novo, batia na mesma linha, e a **segunda** exceção escapava do try — o `Promise.all` rejeitava e a página inteira falhava, não só a play problemática.
  - Virou um `parsePlayTime` que cobre os três formatos que a API usa conforme o endpoint (ISO, datetime do SQL, epoch em segundos) e devolve "agora" no que não der para ler — antes um formato desconhecido virava `Invalid Date` e só estourava adiante, no `toISOString()`, longe da causa.

- **Nove `editReply` soltos em bloco `catch`.** [`replies.js`](src/replies.js)
  - `interaction.editReply(s.erro);` sem `await` nem `.catch()` em nove comandos. Quando a interação já tinha expirado — e por causa da mesma lentidão que causou o erro, já que o token vale 15 min e o retry come tempo — a promise rejeitava solta: o processo não caía (o `index.js` tem handler global), mas o log enchia e **a pessoa não recebia aviso nenhum**.
  - Um `safeEditReply` num módulo próprio, em vez de nove `.catch(() => {})` copiados.

- **Falha ao montar uma página deixava a paginação travada e dessincronizada.** [`pagination.js`](src/pagination.js)
  - O handler do coletor não tinha `try/catch`. Montar a página seguinte faz rede e cálculo de PP; se falhasse, a rejeição vinha **depois** do `deferUpdate`, então o Discord já considerava o clique respondido: a mensagem ficava parada, sem aviso, e o erro só aparecia no `unhandledRejection` global.
  - Pior que o susto: o `page` já tinha sido incrementado. O cursor ficava numa página que nunca chegou à tela, e o clique seguinte partia do lugar errado — pulando uma página a cada falha.

- **Os dois caches em memória não tinham teto de verdade.** [`osuClient.js`](src/osuClient.js), [`mapContext.js`](src/mapContext.js)
  - Ao passar do limite, os dois podavam só o que tinha **expirado**. Com tráfego suficiente para encher a tabela dentro da janela do TTL, tudo está fresco, nada é descartado e o Map cresce sem limite. Invisível num bot pequeno, vazamento num bot grande.
  - A evicção usa a ordem de inserção do Map como recência, então as escritas passaram a fazer `delete` antes do `set`: reatribuir uma chave existente **não** muda a posição dela, e sem isso um canal (ou jogador) consultado o tempo todo seria descartado como se estivesse frio.
  - Junto saiu uma escrita que nunca servia para nada: o cache de usuário indexava `mode:#id` mas **lia** só por texto, então a entrada por ID jamais era encontrada.

- **Caminho de instalação com apóstrofo impedia o bot de subir.** [`db.js`](src/db.js)
  - O `ATTACH DATABASE` montava o caminho por interpolação de string. Não é injeção (vem do `__dirname`), mas `C:\Users\O'Brien\KurataniBot` quebrava o SQL — e num bot que as pessoas auto-hospedam isso não é hipótese remota. Reproduzido: `FALHOU: near "Brien": syntax error`, um erro que não menciona o caminho em lugar nenhum.

- **Corpo de resposta ia inteiro para o log.** [`logger.js`](src/logger.js)
  - Dois casos reais: um 502 de proxy devolve página HTML completa, e o download de `.osu` usa `responseType: 'arraybuffer'` — um Buffer no `JSON.stringify` vira `{"type":"Buffer","data":[...]}`, **um número por byte**. Multiplicado pelas 4 tentativas do retry, uma queda da API escrevia megabytes por comando.
  - O `JSON.stringify` também ganhou `try/catch`: um corpo circular estourava dentro do tratamento de outro erro.

- **A falha do PP do Relax era invisível.** [`pp.js`](src/pp.js)
  - O `stderr` do processo Python nunca era consumido. O `pp_calc.py` faz a parte dele muito bem — escreve a causa exata (`akatsuki-pp-py nao instalado. Execute: pip install akatsuki-pp-py`) — e o Node jogava tudo fora.
  - **A pegadinha**: o script trata os próprios erros, então escreve no stderr **e** imprime `null` no stdout. O `JSON.parse` tem sucesso, e relatar só quando ele estoura deixaria no chão a mensagem que interessa. O relato fica no caminho de "não veio número".
  - Uma vez por **mensagem**, não por processo: um booleano deixaria passar só a primeira causa e calaria as seguintes para sempre. Consumir o stderr também fecha um travamento — o pipe tem buffer, e um filho que escreva demais fica bloqueado até o timeout.

- **A falha de comando no slash saía em português para todo mundo.** [`index.js`](src/index.js)
  - Quando um comando estourava no meio da execução, o handler respondia `'Erro ao executar o comando.'` — string crua, fora do i18n. O caminho do prefixo já respondia traduzido a essa mesma falha.
  - Resolver o idioma lê o banco, e o banco pode ser exatamente o que quebrou. Como este é o último `catch` antes do usuário, uma segunda exceção significaria **não responder nada** — então a leitura do i18n tem fallback para a string fixa.

- **Comentários que descreviam um código que não existe mais.** [`nominate.js`](src/commands/nominate.js), [`pp.js`](src/pp.js), [`daycoreAdmin.js`](src/daycoreAdmin.js)
  - O `NOMINATION_THRESHOLD` vinha com um aviso para **não confiar nele**, dizendo que a contagem era por conta do Discord — essa troca já tinha sido feita, e o comentário desaconselhava um recurso que funciona.
  - O caminho do Relax afirmava que "o script Python baixa o .osu internamente", o oposto do que passou a valer quando os bytes foram para o stdin. E o docblock citava `akatsuki-pp-js ... via Neon/Rust`, um pacote que **não é dependência do projeto**.
  - O `hasPriv` ganhou o comentário que faltava, depois de conferir o upstream: o teste de bits é o mesmo que o bancho.py faz ao despachar um comando (`player.priv & cmd.priv == cmd.priv`), e **não** é hierarquia. Os docstrings do upstream dizem "manage users (level 1/2)", o que convida a "corrigir" isto — mas quem tem DEVELOPER sem o bit de ADMINISTRATOR também é recusado pelo `!restrict` in-game, e transformar em hierarquia daria pelo Discord um acesso que o servidor nega.

## 🧪 Testes

- **128 → 167 casos.** Os novos cobrem o catálogo do `/help` (conferido nos dois sentidos, para um comando futuro não nascer invisível), o prefixo sozinho contra o silêncio do comando desconhecido, os formatos de `play_time`, o teto e a chave dos dois caches, o corte do corpo no log — incluindo a credencial que não pode aparecer —, e a normalização do formato novo de score: o CL, o `statistics` esparso, os campos renomeados, o mapa sem placar e o erro que **não** é 404.

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

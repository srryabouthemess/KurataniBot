# Relatório de alterações

## Resumo

- Corrigido o controle de acesso do `/matchlive list`.
- Impedido o acompanhamento de partidas privadas no modo atual do
  `/matchlive`, que publica atualizações em canais compartilhados.
- Atualizado o README com os comandos, integrações e funcionalidades do bot.

## Segurança

### Partidas privadas no `/matchlive`

O comando permitia que um participante autorizado iniciasse o acompanhamento de
uma partida privada em um canal público. O poller continuava publicando eventos,
mapas e resultados para todos os membros do canal, sem uma verificação de
participantes a cada publicação.

Como o modelo atual de mensagens não oferece uma ACL por participante, a
correção segura é recusar partidas privadas. Partidas públicas continuam
funcionando normalmente.

### Permissão do `/matchlive list`

O comando declarava `ManageChannels`, mas o subcomando `list` retornava as
partidas acompanhadas antes de verificar a permissão. A verificação agora ocorre
antes do despacho de qualquer subcomando.

## Testes adicionados ou ajustados

- Partida privada não cria um acompanhamento, mesmo quando o solicitante
  participou dela.
- `/matchlive list` recusa usuários sem `ManageChannels`.

## Validação

- `npm.cmd run lint`
- `npm.cmd test`

Ambos passaram após as alterações.

## Nota para evolução futura

Para suportar partidas privadas novamente, o recurso precisa mudar o modelo de
entrega: por exemplo, usar mensagens efêmeras/DM por participante ou manter uma
ACL explícita e publicar somente para destinatários autorizados. Apenas validar
quem iniciou o acompanhamento não é suficiente para um poller que escreve em
um canal compartilhado.

# Política de Privacidade / Privacy Policy

*Última atualização / Last updated: 2026-09-28*

[Português](#português) · [English](#english)

---

## Português

O KurataniBot é um bot de Discord que mostra estatísticas de osu! do servidor oficial e de servidores privados. Esta página explica quais dados ele guarda e por quê.

### O que é guardado

| Dado | Quando | Para quê |
|---|---|---|
| Seu ID do Discord, nick e ID de osu! e servidor escolhido | Quando você usa `/link set` | Rodar comandos sem precisar digitar o nick toda vez |
| Idioma, servidor padrão e modo (VN/RX) preferidos | Quando você escolhe um | Lembrar a sua preferência |
| ID do servidor do Discord e idioma dele | Quando um administrador define o idioma | Responder no idioma do servidor |
| Vínculo de staff, nomeações de mapas e registro de ações administrativas | Só para a staff do servidor privado Daycore | Checar permissão e manter histórico de auditoria |

Também fica guardado um cache de mapas (arquivos `.osu`, metadados e dificuldade). Ele não tem nenhum dado pessoal.

### O que não é guardado

- **Conteúdo das mensagens.** O modo de comandos por texto (`k!`) lê só as mensagens que começam com o prefixo, para executar o comando. O texto não é salvo.
- **E-mail, IP, lista de servidores em que você está e qualquer outro dado do seu perfil do Discord.**

### Serviços de terceiros

Para responder aos comandos, o bot consulta APIs públicas de osu!: osu.ppy.sh, Daycore, Gatari, Akatsuki e EZ-PP Farm. Ele envia o nick ou ID de osu! consultado, nunca dados do seu Discord.

### Onde fica e quem acessa

Os dados ficam num banco SQLite no servidor que roda o bot. Só o mantenedor tem acesso, e nada é vendido nem compartilhado.

### Remover seus dados

- `/link remove` apaga seus vínculos de conta.
- Para apagar todo o resto, abra uma issue em <https://github.com/srryabouthemess/KurataniBot/issues>.

### Mudanças

Esta política pode mudar. A data no topo mostra a versão atual.

---

## English

KurataniBot is a Discord bot that shows osu! statistics from the official server and from private servers. This page explains what data it stores and why.

### What is stored

| Data | When | Why |
|---|---|---|
| Your Discord ID, osu! username and ID, and chosen server | When you use `/link set` | Running commands without typing your username every time |
| Preferred language, default server and mode (VN/RX) | When you choose one | Remembering your preference |
| Discord server ID and its language | When an administrator sets the language | Replying in the server's language |
| Staff links, map nominations and an administrative action log | Only for staff of the Daycore private server | Permission checks and an audit trail |

The bot also keeps a beatmap cache (`.osu` files, metadata and difficulty). It contains no personal data.

### What is not stored

- **Message content.** Text command mode (`k!`) only reads messages that start with the prefix, in order to run the command. The text is not saved.
- **Email, IP, the list of servers you are in, and any other data from your Discord profile.**

### Third-party services

To answer commands, the bot queries public osu! APIs: osu.ppy.sh, Daycore, Gatari, Akatsuki and EZ-PP Farm. It sends only the osu! username or ID being looked up, never your Discord data.

### Storage and access

Data is kept in a SQLite database on the server that runs the bot. Only the maintainer can access it, and nothing is sold or shared.

### Removing your data

- `/link remove` deletes your account links.
- To delete everything else, open an issue at <https://github.com/srryabouthemess/KurataniBot/issues>.

### Changes

This policy may change. The date at the top shows the current version.

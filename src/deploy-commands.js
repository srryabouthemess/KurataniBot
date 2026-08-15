const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const db = require('./db');
const { logError } = require('./logger');

const commands = [];
// Ajuste 'commands' para o nome da sua pasta onde estão os arquivos .js dos comandos
const commandsPath = path.join(__dirname, 'commands'); 
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[AVISO] O comando em ${filePath} está faltando a propriedade "data" ou "execute".`);
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Iniciando o registro de ${commands.length} comandos globais...`);

        // ROTA GLOBAL: Não usa o GUILD_ID. 
        // Isso faz o bot funcionar em qualquer servidor automaticamente.
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        // Grava o mesmo hash que o index.js usa para decidir se precisa
        // registrar no boot — sem isso, o próximo start faria um registro
        // redundante logo depois deste.
        // Mesma ordenação do index.js, para os dois gerarem o mesmo hash.
        const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
        const hash = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
        db.setMeta('commands_hash', hash);
        db.close();

        console.log('✅ Sucesso! Comandos registrados globalmente.');
        console.log('💡 Dica: Pode levar até 1 hora para aparecer em todos os servidores devido ao cache do Discord.');
        console.log('ℹ️  O bot agora também registra sozinho no boot quando os comandos mudam;');
        console.log('   este script continua útil para forçar um registro manual.');
    } catch (error) {
        // Pelo logger, não pelo console: um erro de requisição carrega a
        // configuração dela junto (incluindo o header Authorization), e
        // imprimir o objeto cru põe o token do bot no log.
        logError('deploy-commands', error);
    }
})();
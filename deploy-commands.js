const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

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

        console.log('✅ Sucesso! Comandos registrados globalmente.');
        console.log('💡 Dica: Pode levar até 1 hora para aparecer em todos os servidores devido ao cache do Discord.');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
})();
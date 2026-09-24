const { REST, Routes } = require('discord.js');
const config = require('../src/config');
const db = require('../src/db');
const { logError } = require('../src/lib/logger');
const { loadCommands, commandsPayload, hashCommands } = require('../src/bot/loadCommands');

// Estrito, ao contrário do boot: registrar uma lista sem o comando que não
// carregou o apagaria do Discord. Aqui qualquer falha aborta antes do PUT.
config.assertValid();

let commands;
try {
    commands = commandsPayload(loadCommands({ strict: true }).commands);
} catch (error) {
    logError('deploy-commands', error);
    console.error('Registro cancelado: um comando não carregou (ver acima).');
    process.exit(1);
}

const rest = new REST().setToken(config.discord.token);

(async () => {
    try {
        console.log(`Iniciando o registro de ${commands.length} comandos globais...`);

        // ROTA GLOBAL: Não usa o GUILD_ID. 
        // Isso faz o bot funcionar em qualquer servidor automaticamente.
        await rest.put(
            Routes.applicationCommands(config.discord.clientId),
            { body: commands },
        );

        // Grava o mesmo hash que o index.js usa para decidir se precisa
        // registrar no boot — sem isso, o próximo start faria um registro
        // redundante logo depois deste.
        db.setMeta('commands_hash', hashCommands(commands));
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
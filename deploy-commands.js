// Deploy Commands Script - Register slash commands with Discord
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];

// Read all command files
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`📦 Loaded: ${command.data.name}`);
    }
}

// Create REST instance
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Deploy commands
(async () => {
    try {
        console.log('═══════════════════════════════════════════');
        console.log(`🔄 Started refreshing ${commands.length} application (/) commands.`);

        // Register commands to a specific guild (faster for development)
        if (process.env.GUILD_ID) {
            const data = await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands },
            );
            console.log(`✅ Successfully registered ${data.length} guild commands.`);
        }

        // Also register globally (takes ~1 hour to propagate)
        const globalData = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log(`✅ Successfully registered ${globalData.length} global commands.`);

        console.log('═══════════════════════════════════════════');
        console.log('🎉 Commands deployed! You can now use slash commands.');

    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();

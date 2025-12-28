const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Joins your current voice channel'),
    async execute(interaction) {
        const channel = interaction.member.voice.channel;

        if (!channel) {
            return interaction.reply({ content: '❌ You need to be in a voice channel first!', ephemeral: true });
        }

        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false, // Must be false to listen!
            });

            await interaction.reply(`✅ Joined **${channel.name}**! I am listening... 🎙️`);

            // Initialize Voice Manager
            // We need access to the client. Since interaction.client is available...
            if (!interaction.client.voiceManager) {
                const VoiceManager = require('../voice/VoiceManager');
                interaction.client.voiceManager = new VoiceManager(interaction.client);
            }

            interaction.client.voiceManager.setupVoiceHandling(connection, channel.id);

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Failed to join voice channel.', ephemeral: true });
        }
    },
};

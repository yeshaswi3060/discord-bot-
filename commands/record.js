// Record Command - Manually control voice channel recording
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('record')
        .setDescription('🎙️ Control voice channel recording')
        .addSubcommand(subcommand =>
            subcommand.setName('start')
                .setDescription('Start recording a voice channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Voice channel to record')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('stop')
                .setDescription('Stop the current recording')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('status')
                .setDescription('Check current recording status')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const voiceRecorder = interaction.client.voiceRecorder;

        if (!voiceRecorder) {
            return interaction.reply({ content: '❌ Voice recording is not initialized.', ephemeral: true });
        }

        // === START RECORDING ===
        if (subcommand === 'start') {
            const channel = interaction.options.getChannel('channel');

            // Check if already recording
            if (voiceRecorder.isRecording(guildId)) {
                const session = voiceRecorder.getRecordingInfo(guildId);
                return interaction.reply({
                    content: `❌ Already recording **#${session.voiceChannel.name}**!\nUse \`/record stop\` first.`,
                    ephemeral: true
                });
            }

            await interaction.deferReply();

            try {
                const session = await voiceRecorder.startRecording(channel, interaction.guild);

                if (session) {
                    const embed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('🔴 Recording Started')
                        .setDescription(`Now recording **#${channel.name}**`)
                        .addFields(
                            { name: '⏱️ Started', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                            { name: '👥 Members', value: `${channel.members.filter(m => !m.user.bot).size} users`, inline: true }
                        )
                        .setFooter({ text: 'Use /record stop to end recording' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ content: '❌ Failed to start recording. Check bot permissions.' });
                }
            } catch (error) {
                console.error('Record start error:', error);
                await interaction.editReply({ content: '❌ Error starting recording.' });
            }
        }

        // === STOP RECORDING ===
        else if (subcommand === 'stop') {
            if (!voiceRecorder.isRecording(guildId)) {
                return interaction.reply({ content: '❌ No active recording to stop.', ephemeral: true });
            }

            await interaction.deferReply();

            try {
                const session = voiceRecorder.getRecordingInfo(guildId);
                const channelName = session.voiceChannel.name;

                const result = await voiceRecorder.stopRecording(guildId);

                if (result) {
                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('✅ Recording Stopped')
                        .setDescription(`Recording from **#${channelName}** saved!`)
                        .addFields(
                            { name: '⏱️ Duration', value: voiceRecorder.formatDuration(result.duration), inline: true },
                            { name: '👥 Participants', value: `${result.participants}`, inline: true }
                        )
                        .setTimestamp();

                    if (result.driveLink) {
                        embed.addFields({
                            name: '🔗 Recording Link',
                            value: `[View on Google Drive](${result.driveLink})`,
                            inline: false
                        });
                    }

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ content: '⚠️ Recording was too short or failed to save.' });
                }
            } catch (error) {
                console.error('Record stop error:', error);
                await interaction.editReply({ content: '❌ Error stopping recording.' });
            }
        }

        // === STATUS ===
        else if (subcommand === 'status') {
            if (!voiceRecorder.isRecording(guildId)) {
                return interaction.reply({
                    content: '📭 No active recording.\nUse `/record start #channel` to start one.',
                    ephemeral: true
                });
            }

            const session = voiceRecorder.getRecordingInfo(guildId);
            const duration = Date.now() - session.startTime;

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🔴 Recording in Progress')
                .addFields(
                    { name: '📍 Channel', value: `#${session.voiceChannel.name}`, inline: true },
                    { name: '⏱️ Duration', value: voiceRecorder.formatDuration(duration), inline: true },
                    { name: '👥 Participants', value: `${session.participants.size}`, inline: true }
                )
                .setFooter({ text: 'Use /record stop to end recording' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }
    },
};

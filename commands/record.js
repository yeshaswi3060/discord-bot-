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
        )
        .addSubcommand(subcommand =>
            subcommand.setName('auto')
                .setDescription('Toggle auto-recording when users join VC')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable or disable auto-recording')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();
            const guildId = interaction.guild.id;
            const voiceRecorder = interaction.client.voiceRecorder;

            if (!voiceRecorder) {
                return interaction.reply({ content: '❌ Voice recording is not initialized.', ephemeral: true });
            }

            // === AUTO TOGGLE ===
            if (subcommand === 'auto') {
                const enabled = interaction.options.getBoolean('enabled');
                voiceRecorder.setAutoRecord(guildId, enabled);

                const embed = new EmbedBuilder()
                    .setColor(enabled ? '#00FF00' : '#FF0000')
                    .setTitle(enabled ? '✅ Auto-Recording Enabled' : '⏹️ Auto-Recording Disabled')
                    .setDescription(enabled
                        ? 'Bot will now automatically start recording when users join voice channels.'
                        : 'Auto-recording disabled. Use `/record start` to manually record.')
                    .setTimestamp();

                return interaction.reply({ embeds: [embed] });
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
                    await interaction.editReply({ content: '❌ Failed to start recording. Check bot permissions and try again.' });
                }
            }

            // === STOP RECORDING ===
            else if (subcommand === 'stop') {
                if (!voiceRecorder.isRecording(guildId)) {
                    return interaction.reply({ content: '❌ No active recording to stop.', ephemeral: true });
                }

                await interaction.deferReply();

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
                    } else if (result.tooShort) {
                        embed.setDescription(`Recording from **#${channelName}** was too short to save.`);
                        embed.setColor('#FFA500');
                    }

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ content: '⚠️ Recording stopped but failed to save.' });
                }
            }

            // === STATUS ===
            else if (subcommand === 'status') {
                const isAutoEnabled = voiceRecorder.isAutoRecordEnabled(guildId);

                if (!voiceRecorder.isRecording(guildId)) {
                    const embed = new EmbedBuilder()
                        .setColor('#808080')
                        .setTitle('📭 No Active Recording')
                        .setDescription('Use `/record start #channel` to start recording.')
                        .addFields({
                            name: '🔄 Auto-Record',
                            value: isAutoEnabled ? '✅ Enabled' : '❌ Disabled',
                            inline: true
                        })
                        .setTimestamp();

                    return interaction.reply({ embeds: [embed] });
                }

                const session = voiceRecorder.getRecordingInfo(guildId);
                const duration = Date.now() - session.startTime;

                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('🔴 Recording in Progress')
                    .addFields(
                        { name: '📍 Channel', value: `#${session.voiceChannel.name}`, inline: true },
                        { name: '⏱️ Duration', value: voiceRecorder.formatDuration(duration), inline: true },
                        { name: '👥 Participants', value: `${session.participants.size}`, inline: true },
                        { name: '🔄 Auto-Record', value: isAutoEnabled ? '✅ Enabled' : '❌ Disabled', inline: true }
                    )
                    .setFooter({ text: 'Use /record stop to end recording' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Record command error:', error);

            if (interaction.deferred) {
                await interaction.editReply({ content: '❌ An error occurred. Check console for details.' });
            } else if (!interaction.replied) {
                await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
            }
        }
    },
};

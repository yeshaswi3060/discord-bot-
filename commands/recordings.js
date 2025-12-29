// Recordings Command - List voice channel recordings
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recordings')
        .setDescription('🎙️ List voice channel recordings')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of recordings to show (default: 10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(25)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const limit = interaction.options.getInteger('limit') || 10;
        const guildId = interaction.guild.id;

        const { Recording } = interaction.client.db;

        try {
            const recordings = await Recording.find({
                guildId,
                status: 'uploaded'
            })
                .sort({ createdAt: -1 })
                .limit(limit);

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`🎙️ Voice Channel Recordings`)
                .setFooter({ text: `Showing last ${recordings.length} recordings • Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (recordings.length === 0) {
                embed.setDescription('No recordings found yet.\n\nRecordings are automatically created when users join voice channels.');
                return interaction.editReply({ embeds: [embed] });
            }

            // Build description with recordings
            let description = '';
            for (const rec of recordings) {
                const date = new Date(rec.startTime).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const sizeKB = rec.fileSize ? Math.round(rec.fileSize / 1024) : 0;
                const sizeMB = sizeKB > 1000 ? `${(sizeKB / 1024).toFixed(1)}MB` : `${sizeKB}KB`;

                description += `📅 **${date}** • #${rec.channelName}\n`;
                description += `⏱️ ${rec.durationFormatted} • 👥 ${rec.participantCount} participants • 📁 ${sizeMB}\n`;

                if (rec.driveViewLink) {
                    description += `🔗 [View Recording](${rec.driveViewLink})\n`;
                }
                description += '\n';
            }

            embed.setDescription(description);

            // Check if currently recording
            const voiceRecorder = interaction.client.voiceRecorder;
            if (voiceRecorder && voiceRecorder.isRecording(guildId)) {
                const session = voiceRecorder.getRecordingInfo(guildId);
                const currentDuration = Date.now() - session.startTime;
                const durationStr = voiceRecorder.formatDuration(currentDuration);

                embed.addFields({
                    name: '🔴 Currently Recording',
                    value: `**#${session.voiceChannel.name}** - ${durationStr}\n${session.participants.size} participant(s)`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Recordings Error:', error);
            await interaction.editReply({ content: '❌ Error fetching recordings.' });
        }
    },
};

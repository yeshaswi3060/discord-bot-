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
        try {
            await interaction.deferReply();

            const limit = interaction.options.getInteger('limit') || 10;
            const guildId = interaction.guild.id;

            const { Recording } = interaction.client.db;

            if (!Recording) {
                return interaction.editReply({ content: '❌ Recording database not available.' });
            }

            // Show all recordings (not just uploaded ones)
            const recordings = await Recording.find({ guildId })
                .sort({ createdAt: -1 })
                .limit(limit);

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`🎙️ Voice Channel Recordings`)
                .setFooter({ text: `Showing last ${recordings.length} recordings • Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (recordings.length === 0) {
                embed.setDescription('No recordings found yet.\n\nUse `/record start #channel` to start recording.');
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

                const statusEmoji = rec.status === 'uploaded' ? '✅' : rec.status === 'recording' ? '🔴' : '⚠️';

                description += `${statusEmoji} **${date}** • #${rec.channelName}\n`;
                description += `⏱️ ${rec.durationFormatted || 'In progress'} • 👥 ${rec.participantCount || 0} participants\n`;

                if (rec.driveViewLink) {
                    description += `🔗 [View Recording](${rec.driveViewLink})\n`;
                } else if (rec.fileUrl) {
                    description += `🔗 [Download Recording](${rec.fileUrl})\n`;
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
            if (interaction.deferred) {
                await interaction.editReply({ content: '❌ Error fetching recordings.' });
            } else {
                await interaction.reply({ content: '❌ Error fetching recordings.', ephemeral: true });
            }
        }
    },
};

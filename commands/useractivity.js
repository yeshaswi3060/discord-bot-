// User Activity Command - Detailed user activity info
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('useractivity')
        .setDescription('📊 Get detailed activity info for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check activity for')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply(); // This might take a moment

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guild.id;

        const { VCLog, MessageLog, formatDuration, activeSessions } = interaction.client.db;

        try {
            const now = Date.now();
            const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
            const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📊 Detailed Activity: ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            // Check if currently in VC
            const sessionKey = `${guildId}-${targetUser.id}`;
            const activeSession = activeSessions.get(sessionKey);

            if (activeSession) {
                const currentDuration = now - activeSession.joinTime;
                embed.addFields({
                    name: '🟢 Currently Active',
                    value: `In **#${activeSession.channelName}** for ${formatDuration(currentDuration)}`,
                    inline: false
                });
            }

            // === FIRST JOIN TIMES (Past 3 Days) ===
            const vcLogs = await VCLog.find({
                guildId,
                userId: targetUser.id,
                joinTime: { $gte: threeDaysAgo }
            }).sort({ joinTime: 1 });

            // Group by day and get first join
            const dayFirstJoins = {};
            for (const log of vcLogs) {
                const dateKey = new Date(log.joinTime).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                });
                if (!dayFirstJoins[dateKey]) {
                    dayFirstJoins[dateKey] = {
                        time: log.joinTime,
                        channel: log.channelName
                    };
                }
            }

            if (Object.keys(dayFirstJoins).length > 0) {
                const firstJoinText = Object.entries(dayFirstJoins)
                    .slice(-3) // Last 3 days
                    .map(([day, data]) => {
                        const timeStr = new Date(data.time).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        return `📅 **${day}**: First joined **#${data.channel}** at \`${timeStr}\``;
                    })
                    .join('\n');

                embed.addFields({
                    name: '🕐 First VC Join (Past 3 Days)',
                    value: firstJoinText,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '🕐 First VC Join (Past 3 Days)',
                    value: 'No VC activity in the past 3 days',
                    inline: false
                });
            }

            // === 24 HOUR VC ACTIVITY ===
            const recentVCLogs = vcLogs.filter(log => log.joinTime >= twentyFourHoursAgo);

            if (recentVCLogs.length > 0) {
                let totalVCTime = 0;
                const vcActivityText = recentVCLogs
                    .slice(-10) // Show last 10 sessions
                    .map(log => {
                        totalVCTime += log.duration;
                        const joinTimeStr = new Date(log.joinTime).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        return `• **#${log.channelName}** at \`${joinTimeStr}\` → ${formatDuration(log.duration)}`;
                    })
                    .join('\n');

                embed.addFields({
                    name: `🎙️ VC Activity (Last 24h) - Total: ${formatDuration(totalVCTime)}`,
                    value: vcActivityText + (recentVCLogs.length > 10 ? `\n*...and ${recentVCLogs.length - 10} more sessions*` : ''),
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '🎙️ VC Activity (Last 24h)',
                    value: 'No VC activity in the last 24 hours',
                    inline: false
                });
            }

            // === 24 HOUR MESSAGE ACTIVITY ===
            const messageLogs = await MessageLog.find({
                guildId,
                userId: targetUser.id,
                timestamp: { $gte: twentyFourHoursAgo }
            });

            if (messageLogs.length > 0) {
                // Count by channel
                const channelCounts = {};
                for (const log of messageLogs) {
                    if (!channelCounts[log.channelName]) {
                        channelCounts[log.channelName] = 0;
                    }
                    channelCounts[log.channelName]++;
                }

                const sortedChannels = Object.entries(channelCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);

                const messageText = sortedChannels
                    .map(([channel, count], i) => {
                        const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▪️';
                        return `${emoji} **#${channel}**: ${count} message${count !== 1 ? 's' : ''}`;
                    })
                    .join('\n');

                embed.addFields({
                    name: `💬 Messages (Last 24h) - Total: ${messageLogs.length}`,
                    value: messageText,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '💬 Messages (Last 24h)',
                    value: 'No messages tracked in the last 24 hours',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('User Activity Error:', error);
            await interaction.editReply({ content: '❌ Error fetching activity data.' });
        }
    },
};

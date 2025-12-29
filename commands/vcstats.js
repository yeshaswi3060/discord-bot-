// VC Stats Command - View voice channel statistics for a user
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vcstats')
        .setDescription('🎙️ View voice channel statistics')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check stats for')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Special action')
                .setRequired(false)
                .addChoices(
                    { name: '🗑️ Clear Monthly Stats', value: 'clear_monthly' }
                )
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const action = interaction.options.getString('action');
        const guildId = interaction.guild.id;

        const { VCStat, formatDuration, activeSessions } = interaction.client.db;

        // Handle clear action
        if (action === 'clear_monthly') {
            if (targetUser.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ You can only clear your own stats!', ephemeral: true });
            }

            try {
                const now = new Date();
                const monthKey = now.toISOString().split('T')[0].substring(0, 7); // "YYYY-MM"

                await VCStat.updateOne(
                    { guildId, userId: interaction.user.id },
                    { $unset: { [`monthlyStats.${monthKey}`]: 1 } }
                );

                return interaction.reply({
                    content: `✅ Your monthly stats for **${monthKey}** have been cleared!`,
                    ephemeral: true
                });
            } catch (error) {
                console.error(error);
                return interaction.reply({ content: '❌ Error clearing stats.', ephemeral: true });
            }
        }

        try {
            const userStats = await VCStat.findOne({ guildId, userId: targetUser.id });

            // Check if user is currently in VC
            const sessionKey = `${guildId}-${targetUser.id}`;
            const activeSession = activeSessions.get(sessionKey);

            const embed = new EmbedBuilder()
                .setColor(activeSession ? '#00ff00' : '#5865F2')
                .setTitle(`🎙️ Voice Channel Stats`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (activeSession) {
                const currentDuration = Date.now() - activeSession.joinTime;
                embed.addFields({
                    name: '🟢 Currently Active',
                    value: `In **#${activeSession.channelName}** for ${formatDuration(currentDuration)}`,
                    inline: false
                });
            }

            if (!userStats) {
                embed.setDescription(`📊 **${targetUser.username}**\n\nNo voice channel history recorded yet.`);
                return interaction.reply({ embeds: [embed] });
            }

            embed.setDescription(`📊 **${targetUser.username}**`);

            embed.addFields(
                { name: '⏱️ Total Time', value: formatDuration(userStats.totalTime), inline: true },
                { name: '📊 Sessions', value: userStats.sessionCount.toString(), inline: true },
                { name: '📈 Avg Session', value: formatDuration(Math.floor(userStats.totalTime / userStats.sessionCount)), inline: true }
            );

            // === TODAY'S ACTIVITY ===
            const now = new Date();
            const todayKey = now.toISOString().split('T')[0]; // "YYYY-MM-DD"
            const monthKey = todayKey.substring(0, 7); // "YYYY-MM"

            let todayTime = 0;
            let todaySessions = 0;
            if (userStats.dailyStats && userStats.dailyStats.get(todayKey)) {
                const todayData = userStats.dailyStats.get(todayKey);
                todayTime = todayData.time || 0;
                todaySessions = todayData.sessions || 0;
            }

            embed.addFields({
                name: '📅 Today\'s Activity',
                value: todayTime > 0
                    ? `${formatDuration(todayTime)} (${todaySessions} session${todaySessions !== 1 ? 's' : ''})`
                    : 'No activity today',
                inline: true
            });

            // === MONTHLY ACTIVITY ===
            let monthTime = 0;
            let monthSessions = 0;
            if (userStats.monthlyStats && userStats.monthlyStats.get(monthKey)) {
                const monthData = userStats.monthlyStats.get(monthKey);
                monthTime = monthData.time || 0;
                monthSessions = monthData.sessions || 0;
            }

            embed.addFields({
                name: '📆 This Month',
                value: monthTime > 0
                    ? `${formatDuration(monthTime)} (${monthSessions} session${monthSessions !== 1 ? 's' : ''})`
                    : 'No activity this month',
                inline: true
            });

            // === LAST 24 HOURS ===
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
            let last24hTime = 0;
            let last24hSessions = 0;

            if (userStats.recentSessions && userStats.recentSessions.length > 0) {
                for (const session of userStats.recentSessions) {
                    if (session.joinTime >= twentyFourHoursAgo) {
                        last24hTime += session.duration;
                        last24hSessions++;
                    }
                }
            }

            embed.addFields({
                name: '⏰ Last 24 Hours',
                value: last24hTime > 0
                    ? `${formatDuration(last24hTime)} (${last24hSessions} session${last24hSessions !== 1 ? 's' : ''})`
                    : 'No activity in last 24h',
                inline: true
            });

            // Channel breakdown (Map)
            if (userStats.channelBreakdown && userStats.channelBreakdown.size > 0) {
                // Convert Map to Array for sorting
                const channelArray = Array.from(userStats.channelBreakdown.entries())
                    .map(([id, data]) => ({ id, ...data.toObject() })); // Ensure plain object

                const channelList = channelArray
                    .sort((a, b) => b.time - a.time)
                    .slice(0, 5)
                    .map((data, index) => {
                        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▪️';
                        return `${emoji} **#${data.name}**: ${formatDuration(data.time)} (${data.sessions} sessions)`;
                    })
                    .join('\n');

                embed.addFields({
                    name: '📍 Top Channels',
                    value: channelList || 'No data',
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Error fetching stats.', ephemeral: true });
        }
    },
};

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
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guild.id;

        const { VCStat, formatDuration, activeSessions } = interaction.client.db;

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

// Message Stats Command - View message statistics for a user
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('messagestats')
        .setDescription('💬 View message statistics')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check stats for')
                .setRequired(false)
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guild.id;

        const { MessageStat } = interaction.client.db;

        try {
            const userStats = await MessageStat.findOne({ guildId, userId: targetUser.id });

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`💬 Message Statistics`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (!userStats) {
                embed.setDescription(`📊 **${targetUser.username}**\n\nNo message history recorded yet.`);
                return interaction.reply({ embeds: [embed] });
            }

            embed.setDescription(`📊 **${targetUser.username}**`);

            const lastActiveAgo = formatTimeAgo(userStats.lastActive);

            embed.addFields(
                { name: '💬 Total Messages', value: userStats.totalMessages.toLocaleString(), inline: true },
                { name: '🕐 Last Active', value: lastActiveAgo, inline: true }
            );

            // Channel breakdown
            if (userStats.channelBreakdown && userStats.channelBreakdown.size > 0) {
                const channelArray = Array.from(userStats.channelBreakdown.entries())
                    .map(([id, data]) => ({ id, ...data.toObject() }));

                const channelList = channelArray
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
                    .map((data, index) => {
                        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▪️';
                        const percentage = ((data.count / userStats.totalMessages) * 100).toFixed(1);
                        return `${emoji} **#${data.name}**: ${data.count.toLocaleString()} (${percentage}%)`;
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

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

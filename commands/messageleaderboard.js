// Message Leaderboard Command - View top chatters
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('messageleaderboard')
        .setDescription('🏆 View message leaderboard'),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        const { MessageStat } = interaction.client.db;

        try {
            const topUsers = await MessageStat.find({ guildId })
                .sort({ totalMessages: -1 })
                .limit(10);

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle(`🏆 Message Leaderboard`)
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (topUsers.length === 0) {
                embed.setDescription('No message activity recorded yet.\n\nStart chatting to appear on the leaderboard!');
                return interaction.reply({ embeds: [embed] });
            }

            const leaderboard = topUsers.map((data, index) => {
                let emoji;
                switch (index) {
                    case 0: emoji = '🥇'; break;
                    case 1: emoji = '🥈'; break;
                    case 2: emoji = '🥉'; break;
                    default: emoji = `**${index + 1}.**`;
                }
                return `${emoji} <@${data.userId}>\n   💬 ${data.totalMessages.toLocaleString()} messages`;
            });

            embed.setDescription(leaderboard.join('\n\n'));

            // Aggegration for totals
            const totals = await MessageStat.aggregate([
                { $match: { guildId } },
                { $group: { _id: null, totalMessages: { $sum: '$totalMessages' }, activeUsers: { $sum: 1 } } }
            ]);

            const totalMessages = totals[0]?.totalMessages || 0;
            const totalUsers = totals[0]?.activeUsers || 0;

            embed.addFields({
                name: '📊 Server Totals',
                value: `💬 Total Messages: **${totalMessages.toLocaleString()}**\n👥 Active Users: **${totalUsers}**`,
                inline: false
            });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Error fetching leaderboard.', ephemeral: true });
        }
    },
};

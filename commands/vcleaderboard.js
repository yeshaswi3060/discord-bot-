// VC Leaderboard Command - View top voice channel users
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vcleaderboard')
        .setDescription('🏆 View voice channel leaderboard'),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        const { VCStat, formatDuration } = interaction.client.db;

        try {
            // Fetch top 10 users sorted by time
            const topUsers = await VCStat.find({ guildId })
                .sort({ totalTime: -1 })
                .limit(10);

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle(`🏆 Voice Channel Leaderboard`)
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (topUsers.length === 0) {
                embed.setDescription('No voice channel activity recorded yet.\n\nStart chatting in voice channels to appear on the leaderboard!');
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
                return `${emoji} <@${data.userId}>\n   ⏱️ ${formatDuration(data.totalTime)} • ${data.sessionCount} sessions`;
            });

            embed.setDescription(leaderboard.join('\n\n'));

            // Calculate totals via Aggregation
            const totals = await VCStat.aggregate([
                { $match: { guildId } },
                { $group: { _id: null, totalTime: { $sum: '$totalTime' }, totalSessions: { $sum: '$sessionCount' } } }
            ]);

            const totalServerTime = totals[0]?.totalTime || 0;
            const totalSessions = totals[0]?.totalSessions || 0;

            embed.addFields({
                name: '📊 Server Totals',
                value: `⏱️ Total Time: **${formatDuration(totalServerTime)}**\n📊 Total Sessions: **${totalSessions}**`,
                inline: false
            });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Error fetching leaderboard.', ephemeral: true });
        }
    },
};

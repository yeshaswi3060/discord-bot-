// VC Log Command - View recent voice channel activity
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vclog')
        .setDescription('📜 View recent voice channel activity')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of entries to show (default: 10)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Filter by specific user')
                .setRequired(false)
        ),

    async execute(interaction) {
        const limit = interaction.options.getInteger('limit') || 10;
        const filterUser = interaction.options.getUser('user');
        const guildId = interaction.guild.id;

        const { VCLog, formatDuration } = interaction.client.db;

        try {
            // Build Query
            const query = { guildId };
            if (filterUser) {
                query.userId = filterUser.id;
            }

            // Fetch Logs
            const logs = await VCLog.find(query)
                .sort({ leaveTime: -1 })
                .limit(limit);

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📜 Voice Channel Log`)
                .setFooter({ text: `Showing ${logs.length} entries • Requested by ${interaction.user.tag}` })
                .setTimestamp();

            if (filterUser) {
                embed.setDescription(`Filtered by: ${filterUser.username}`);
            }

            if (logs.length === 0) {
                embed.setDescription('No voice channel activity recorded yet.');
                return interaction.reply({ embeds: [embed] });
            }

            const logEntries = logs.map((log, index) => {
                const timeAgo = formatTimeAgo(log.leaveTime);
                const switchNote = log.switchedTo ? ` → #${log.switchedTo}` : '';
                return `**${index + 1}.** <@${log.userId}> in **#${log.channelName}**${switchNote}\n   ⏱️ ${log.durationFormatted} • ${timeAgo}`;
            }).join('\n\n');

            embed.addFields({
                name: '📋 Recent Activity',
                value: logEntries.slice(0, 4000),
                inline: false
            });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Error fetching logs.', ephemeral: true });
        }
    },
};

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

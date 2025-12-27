// Server Info Command - Get information about the server
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('🏠 Get information about this server'),

    async execute(interaction) {
        const { guild } = interaction;

        // Fetch more guild data
        await guild.fetch();

        // Count channel types
        const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
        const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
        const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;

        // Get verification level text
        const verificationLevels = {
            0: 'None',
            1: 'Low',
            2: 'Medium',
            3: 'High',
            4: 'Very High'
        };

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`🏠 ${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: '🆔 Server ID', value: guild.id, inline: true },
                { name: '👥 Members', value: guild.memberCount.toString(), inline: true },
                { name: '💬 Text Channels', value: textChannels.toString(), inline: true },
                { name: '🔊 Voice Channels', value: voiceChannels.toString(), inline: true },
                { name: '📁 Categories', value: categories.toString(), inline: true },
                { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
                { name: '😀 Emojis', value: guild.emojis.cache.size.toString(), inline: true },
                { name: '🛡️ Verification', value: verificationLevels[guild.verificationLevel], inline: true },
                { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🚀 Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
                { name: '💎 Boosts', value: guild.premiumSubscriptionCount?.toString() || '0', inline: true },
            )
            .setFooter({ text: `Requested by ${interaction.user.tag}` })
            .setTimestamp();

        if (guild.bannerURL()) {
            embed.setImage(guild.bannerURL({ size: 1024 }));
        }

        await interaction.reply({ embeds: [embed] });
    },
};

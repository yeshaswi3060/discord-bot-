const mongoose = require('mongoose');

const messageStatSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    totalMessages: { type: Number, default: 0 },
    lastActive: { type: Number, default: Date.now },
    channelBreakdown: {
        type: Map,
        of: new mongoose.Schema({
            name: String,
            count: { type: Number, default: 0 }
        })
    }
});

// Compound index
messageStatSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('MessageStat', messageStatSchema);

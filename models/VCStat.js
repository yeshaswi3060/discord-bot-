const mongoose = require('mongoose');

const vcStatSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    totalTime: { type: Number, default: 0 },
    sessionCount: { type: Number, default: 0 },
    channelBreakdown: {
        type: Map,
        of: new mongoose.Schema({
            name: String,
            time: { type: Number, default: 0 },
            sessions: { type: Number, default: 0 }
        })
    }
});

// Compound index to ensure unique stats per user per guild
vcStatSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('VCStat', vcStatSchema);

const mongoose = require('mongoose');

const messageLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    timestamp: { type: Number, required: true }
});

// Index for efficient queries
messageLogSchema.index({ guildId: 1, userId: 1, timestamp: -1 });

// TTL index: auto-delete messages older than 3 days (259200 seconds)
messageLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 259200 });

module.exports = mongoose.model('MessageLog', messageLogSchema);

const mongoose = require('mongoose');

const vcLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    guildId: { type: String, required: true },
    joinTime: { type: Number, required: true },
    leaveTime: { type: Number, required: true },
    duration: { type: Number, required: true },
    durationFormatted: { type: String, required: true },
    switchedTo: { type: String } // Optional: name of channel switched to
}, { timestamps: true });

module.exports = mongoose.model('VCLog', vcLogSchema);

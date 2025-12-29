const mongoose = require('mongoose');

const recordingSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    guildName: { type: String },
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number },
    duration: { type: Number },
    durationFormatted: { type: String },
    participants: [{ type: String }], // Array of user IDs
    participantCount: { type: Number, default: 0 },
    fileSize: { type: Number }, // in bytes
    driveFileId: { type: String },
    driveViewLink: { type: String },
    driveDownloadLink: { type: String },
    status: { type: String, enum: ['recording', 'processing', 'uploaded', 'failed'], default: 'recording' }
}, { timestamps: true });

// Index for efficient queries
recordingSchema.index({ guildId: 1, createdAt: -1 });

module.exports = mongoose.model('Recording', recordingSchema);

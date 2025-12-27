const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    history: [{
        role: { type: String, required: true }, // 'user', 'assistant', 'system'
        content: { type: String, required: true }
    }],
    lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', conversationSchema);

const {
    EndBehaviorType,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    AudioPlayerStatus
} = require('@discordjs/voice');
const prism = require('prism-media');
const { pipeline } = require('stream');
const fs = require('fs');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const { WaveFile } = require('wavefile');
const FormData = require('form-data');
const ffmpegPath = require('ffmpeg-static');

class VoiceManager {
    constructor(client) {
        this.client = client;
        this.isProcessing = false;
        // Map to prevent simultaneous processing for same user
        this.processingUsers = new Set();
    }

    setupVoiceHandling(connection, channelId) {
        console.log(`🎙️ Voice Handler attached to ${channelId}`);

        // Play a greeting to confirm it works
        this.speak(connection, "Hello! I am ready to listen.");

        connection.receiver.speaking.on('start', (userId) => {
            if (this.processingUsers.has(userId) || this.isProcessing) return;
            this.handleUserSpeaking(connection, userId);
        });
    }

    async handleUserSpeaking(connection, userId) {
        this.processingUsers.add(userId);

        const opusStream = connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000, // Stop after 1s silence
            },
        });

        const pcmBuffer = [];

        // Opus -> PCM Decoder (using prism-media which wraps ffmpeg or opus)
        // Since we installed ffmpeg-static, we can use ffmpeg to decode opus to pcm_s16le
        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });

        opusStream.pipe(decoder);

        decoder.on('data', (chunk) => {
            pcmBuffer.push(chunk);
        });

        decoder.on('end', async () => {
            if (pcmBuffer.length === 0) {
                this.processingUsers.delete(userId);
                return;
            }

            const BufferData = Buffer.concat(pcmBuffer);
            // Ignore very short audio (likely noise) < 1s (48000 * 2 bytes * 1s = 96000 bytes)
            if (BufferData.length < 50000) {
                this.processingUsers.delete(userId);
                return;
            }

            try {
                // 1. Convert PCM to WAV
                const wav = new WaveFile();
                wav.fromScratch(1, 48000, '16', BufferData);
                const wavBuffer = wav.toBuffer();

                // 2. Transcribe (Groq Whisper)
                const transcription = await this.transcribeAudio(wavBuffer);
                if (!transcription || transcription.trim().length < 2) {
                    this.processingUsers.delete(userId);
                    return;
                }

                console.log(`🗣️ User (${userId}) said: ${transcription}`);

                // 3. Get AI Response
                const aiResponse = await this.getAIResponse(transcription);
                console.log(`🤖 AI Reply: ${aiResponse}`);

                // 4. Speak
                await this.speak(connection, aiResponse);

            } catch (err) {
                console.error('Voice Processing Error:', err);
            } finally {
                this.processingUsers.delete(userId);
            }
        });
    }

    async transcribeAudio(wavBuffer) {
        try {
            const form = new FormData();
            form.append('file', wavBuffer, 'audio.wav');
            form.append('model', 'distil-whisper-large-v3-en'); // Groq Model

            const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY_2}`
                }
            });
            return response.data.text;
        } catch (error) {
            console.error('STT Error:', error.response?.data || error.message);
            return null;
        }
    }

    async getAIResponse(text) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: 'You are a helpful voice assistant in a Discord call. Keep your answers brief, conversational, and friendly (max 2 sentences).' },
                        { role: 'user', content: text }
                    ]
                },
                {
                    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY_1}` }
                }
            );
            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('LLM Error:', error.message);
            return "Sorry, I can't think right now.";
        }
    }

    async speak(connection, text) {
        if (!text) return;

        console.log(`🗣️ Speaking: "${text}"`);

        // FIX: Ensure Prism finds FFMPEG
        if (!process.env.FFMPEG_PATH) {
            process.env.FFMPEG_PATH = require('ffmpeg-static');
            console.log(`🔧 Set FFMPEG_PATH to: ${process.env.FFMPEG_PATH}`);
        }

        // Google TTS (Free, URL-based)
        // Split text if too long (200 chars limit for Google TTS free)
        // We'll trust google-tts-api to handle split or just truncate for now

        const url = googleTTS.getAudioUrl(text, {
            lang: 'en',
            slow: false,
            host: 'https://translate.google.com',
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(url, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        player.play(resource);
        connection.subscribe(player);

        player.on('error', error => {
            console.error('❌ Audio Player Error:', error.message);
        });

        player.on('stateChange', (oldState, newState) => {
            console.log(`🎵 Audio Player State: ${oldState.status} -> ${newState.status}`);
        });

        return new Promise((resolve) => {
            player.on(AudioPlayerStatus.Idle, () => {
                resolve();
            });
        });
    }
}

module.exports = VoiceManager;

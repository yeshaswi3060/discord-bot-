// Voice Recorder - Captures, mixes, and saves voice channel audio
const {
    joinVoiceChannel,
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

class VoiceRecorder {
    constructor(client) {
        this.client = client;
        this.activeRecordings = new Map(); // guildId -> recording session
        this.recordingsDir = path.join(__dirname, '..', 'recordings');

        // Create recordings directory if it doesn't exist
        if (!fs.existsSync(this.recordingsDir)) {
            fs.mkdirSync(this.recordingsDir, { recursive: true });
        }
    }

    /**
     * Start recording a voice channel
     */
    async startRecording(voiceChannel, guild) {
        const guildId = guild.id;

        // Check if already recording in this guild
        if (this.activeRecordings.has(guildId)) {
            console.log(`⚠️ Already recording in guild ${guild.name}`);
            return null;
        }

        try {
            // Join the voice channel
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false, // Must NOT be deaf to receive audio
                selfMute: true   // Mute ourselves
            });

            // Wait for connection to be ready
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            console.log(`🎙️ Started recording in #${voiceChannel.name} (${guild.name})`);

            // Create recording session
            const startTime = Date.now();
            const fileName = `${guild.id}_${voiceChannel.id}_${startTime}`;
            const pcmPath = path.join(this.recordingsDir, `${fileName}.pcm`);
            const mp3Path = path.join(this.recordingsDir, `${fileName}.mp3`);

            // Create write stream for mixed audio
            const writeStream = fs.createWriteStream(pcmPath);

            // Track participants
            const participants = new Set();
            const userStreams = new Map();

            // Set up audio mixing buffer
            const mixBuffer = [];
            let mixInterval = null;

            // Listen to all users speaking
            connection.receiver.speaking.on('start', (userId) => {
                if (userStreams.has(userId)) return;

                participants.add(userId);

                const audioStream = connection.receiver.subscribe(userId, {
                    end: { behavior: EndBehaviorType.Manual }
                });

                // Decode Opus to PCM
                const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
                audioStream.pipe(decoder);

                decoder.on('data', (chunk) => {
                    // Write directly to file (simple approach - works for single/few users)
                    writeStream.write(chunk);
                });

                decoder.on('error', (err) => {
                    console.error(`Decoder error for user ${userId}:`, err.message);
                });

                userStreams.set(userId, { audioStream, decoder });
            });

            // Store recording session
            const session = {
                connection,
                voiceChannel,
                guild,
                startTime,
                pcmPath,
                mp3Path,
                fileName,
                writeStream,
                participants,
                userStreams,
                Recording: this.client.db.Recording
            };

            this.activeRecordings.set(guildId, session);

            // Create database record
            const Recording = this.client.db.Recording;
            const recordingDoc = await Recording.create({
                guildId: guild.id,
                guildName: guild.name,
                channelId: voiceChannel.id,
                channelName: voiceChannel.name,
                startTime,
                status: 'recording'
            });

            session.recordingId = recordingDoc._id;

            return session;

        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            this.activeRecordings.delete(guildId);
            return null;
        }
    }

    /**
     * Stop recording and process the file
     */
    async stopRecording(guildId) {
        const session = this.activeRecordings.get(guildId);
        if (!session) return null;

        try {
            const endTime = Date.now();
            const duration = endTime - session.startTime;

            console.log(`⏹️ Stopping recording in #${session.voiceChannel.name}`);

            // Close all user streams
            for (const [userId, streams] of session.userStreams) {
                try {
                    streams.decoder.destroy();
                    streams.audioStream.destroy();
                } catch (e) { }
            }

            // Close write stream
            session.writeStream.end();

            // Disconnect from voice
            session.connection.destroy();

            // Wait a moment for file to finish writing
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if we have any audio data
            const stats = fs.statSync(session.pcmPath);
            if (stats.size < 1000) {
                console.log('⚠️ Recording too short, discarding');
                fs.unlinkSync(session.pcmPath);
                this.activeRecordings.delete(guildId);
                return null;
            }

            // Convert PCM to MP3
            console.log('🔄 Converting to MP3...');
            await this.convertToMp3(session.pcmPath, session.mp3Path);

            // Delete PCM file
            fs.unlinkSync(session.pcmPath);

            // Upload to Google Drive
            const GoogleDriveService = require('../services/GoogleDriveService');
            const driveFileName = `${session.guild.name}_${session.voiceChannel.name}_${new Date(session.startTime).toISOString().split('T')[0]}.mp3`;

            console.log('☁️ Uploading to Google Drive...');
            const driveResult = await GoogleDriveService.uploadFile(session.mp3Path, driveFileName);

            // Update database record
            const Recording = session.Recording;
            const mp3Stats = fs.statSync(session.mp3Path);

            await Recording.findByIdAndUpdate(session.recordingId, {
                endTime,
                duration,
                durationFormatted: this.formatDuration(duration),
                participants: Array.from(session.participants),
                participantCount: session.participants.size,
                fileSize: mp3Stats.size,
                driveFileId: driveResult?.id,
                driveViewLink: driveResult?.viewLink,
                driveDownloadLink: driveResult?.downloadLink,
                status: driveResult ? 'uploaded' : 'failed'
            });

            // Clean up local MP3 file after upload
            if (driveResult) {
                fs.unlinkSync(session.mp3Path);
            }

            console.log(`✅ Recording saved: ${this.formatDuration(duration)}, ${session.participants.size} participants`);

            this.activeRecordings.delete(guildId);

            return {
                duration,
                participants: session.participants.size,
                driveLink: driveResult?.viewLink
            };

        } catch (error) {
            console.error('❌ Error stopping recording:', error);
            this.activeRecordings.delete(guildId);
            return null;
        }
    }

    /**
     * Convert PCM to MP3 using ffmpeg
     */
    convertToMp3(pcmPath, mp3Path) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, [
                '-f', 's16le',           // Input format: signed 16-bit little-endian
                '-ar', '48000',          // Sample rate
                '-ac', '1',              // Mono
                '-i', pcmPath,           // Input file
                '-b:a', '128k',          // Bitrate
                '-y',                    // Overwrite output
                mp3Path                  // Output file
            ]);

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`ffmpeg exited with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);
        });
    }

    /**
     * Check if a channel should start/stop recording
     */
    async handleVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const guildId = guild.id;
        const isRecording = this.activeRecordings.has(guildId);

        // User joined a voice channel
        if (!oldState.channel && newState.channel && !newState.member.user.bot) {
            if (!isRecording) {
                // Start recording in this channel
                await this.startRecording(newState.channel, guild);
            }
        }

        // User left a voice channel
        if (oldState.channel && !newState.channel) {
            if (isRecording) {
                const session = this.activeRecordings.get(guildId);
                // Check if the recording channel is now empty (minus bots)
                const members = session.voiceChannel.members.filter(m => !m.user.bot);
                if (members.size === 0) {
                    await this.stopRecording(guildId);

                    // Check if there's another active VC to record
                    const otherVC = guild.channels.cache.find(c =>
                        c.type === 2 && // Voice channel
                        c.id !== session.voiceChannel.id &&
                        c.members.filter(m => !m.user.bot).size > 0
                    );

                    if (otherVC) {
                        await this.startRecording(otherVC, guild);
                    }
                }
            }
        }

        // User switched channels
        if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            if (isRecording) {
                const session = this.activeRecordings.get(guildId);
                // If the old channel (being recorded) is now empty
                if (session.voiceChannel.id === oldState.channel.id) {
                    const members = oldState.channel.members.filter(m => !m.user.bot);
                    if (members.size === 0) {
                        await this.stopRecording(guildId);
                        // Start recording the new channel
                        await this.startRecording(newState.channel, guild);
                    }
                }
            }
        }
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Check if recording in a guild
     */
    isRecording(guildId) {
        return this.activeRecordings.has(guildId);
    }

    /**
     * Get active recording info
     */
    getRecordingInfo(guildId) {
        return this.activeRecordings.get(guildId);
    }
}

module.exports = VoiceRecorder;

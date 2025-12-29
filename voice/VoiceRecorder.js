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
        this.autoRecordEnabled = new Map(); // guildId -> boolean (default: false)
        this.recordingsDir = path.join(__dirname, '..', 'recordings');

        // Create recordings directory if it doesn't exist
        if (!fs.existsSync(this.recordingsDir)) {
            fs.mkdirSync(this.recordingsDir, { recursive: true });
        }

        console.log('🎙️ Voice Recorder initialized');
    }

    /**
     * Toggle auto-recording for a guild
     */
    setAutoRecord(guildId, enabled) {
        this.autoRecordEnabled.set(guildId, enabled);
        return enabled;
    }

    /**
     * Check if auto-recording is enabled for a guild
     */
    isAutoRecordEnabled(guildId) {
        return this.autoRecordEnabled.get(guildId) || false;
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
            console.log(`🎙️ Attempting to join #${voiceChannel.name}...`);

            // Join the voice channel
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false, // Must NOT be deaf to receive audio
                selfMute: true   // Mute ourselves
            });

            // Handle connection state changes
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                console.log('⚠️ Voice connection disconnected, attempting to reconnect...');
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                    // Seems to be reconnecting
                } catch (error) {
                    // Seems to be a real disconnect
                    console.log('❌ Voice connection lost, stopping recording');
                    this.stopRecording(guildId);
                }
            });

            connection.on('error', (error) => {
                console.error('❌ Voice connection error:', error.message);
            });

            // Wait for connection to be ready (60 second timeout for cloud hosting)
            await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
            console.log(`✅ Connected to #${voiceChannel.name} (${guild.name})`);

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

            // Listen to all users speaking
            connection.receiver.speaking.on('start', (userId) => {
                if (userStreams.has(userId)) return;

                participants.add(userId);
                console.log(`🎤 User ${userId} started speaking`);

                try {
                    const audioStream = connection.receiver.subscribe(userId, {
                        end: { behavior: EndBehaviorType.Manual }
                    });

                    // Decode Opus to PCM
                    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
                    audioStream.pipe(decoder);

                    decoder.on('data', (chunk) => {
                        writeStream.write(chunk);
                    });

                    decoder.on('error', (err) => {
                        console.error(`Decoder error for user ${userId}:`, err.message);
                    });

                    userStreams.set(userId, { audioStream, decoder });
                } catch (err) {
                    console.error(`Error subscribing to user ${userId}:`, err);
                }
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
                recordingId: null
            };

            this.activeRecordings.set(guildId, session);

            // Create database record (with error handling)
            try {
                const Recording = this.client.db?.Recording;
                if (Recording) {
                    const recordingDoc = await Recording.create({
                        guildId: guild.id,
                        guildName: guild.name,
                        channelId: voiceChannel.id,
                        channelName: voiceChannel.name,
                        startTime,
                        status: 'recording'
                    });
                    session.recordingId = recordingDoc._id;
                }
            } catch (dbErr) {
                console.error('DB error creating recording:', dbErr.message);
            }

            console.log(`🔴 Recording started in #${voiceChannel.name}`);
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
        if (!session) {
            console.log('⚠️ No active recording to stop');
            return null;
        }

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
            try {
                session.connection.destroy();
            } catch (e) { }

            // Wait a moment for file to finish writing
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if we have any audio data
            let fileSize = 0;
            try {
                const stats = fs.statSync(session.pcmPath);
                fileSize = stats.size;
            } catch (e) {
                console.log('⚠️ No PCM file found');
                this.activeRecordings.delete(guildId);
                return null;
            }

            if (fileSize < 1000) {
                console.log('⚠️ Recording too short, discarding');
                try { fs.unlinkSync(session.pcmPath); } catch (e) { }
                this.activeRecordings.delete(guildId);
                return { duration, participants: session.participants.size, driveLink: null, tooShort: true };
            }

            // Convert PCM to MP3
            console.log('🔄 Converting to MP3...');
            try {
                await this.convertToMp3(session.pcmPath, session.mp3Path);
            } catch (convErr) {
                console.error('❌ FFmpeg conversion failed:', convErr);
                try { fs.unlinkSync(session.pcmPath); } catch (e) { }
                this.activeRecordings.delete(guildId);
                return { duration, participants: session.participants.size, driveLink: null, conversionFailed: true };
            }

            // Delete PCM file
            try { fs.unlinkSync(session.pcmPath); } catch (e) { }

            // Upload to file.io (free hosting)
            let uploadResult = null;
            try {
                const FileUploadService = require('../services/FileUploadService');
                const uploadFileName = `${session.guild.name}_${session.voiceChannel.name}_${new Date(session.startTime).toISOString().split('T')[0]}.mp3`;

                console.log('☁️ Uploading to file.io...');
                uploadResult = await FileUploadService.uploadFile(session.mp3Path, uploadFileName);
            } catch (uploadErr) {
                console.error('❌ Upload failed:', uploadErr.message);
            }

            // Update database record
            try {
                const Recording = this.client.db?.Recording;
                if (Recording && session.recordingId) {
                    const mp3Stats = fs.statSync(session.mp3Path);

                    await Recording.findByIdAndUpdate(session.recordingId, {
                        endTime,
                        duration,
                        durationFormatted: this.formatDuration(duration),
                        participants: Array.from(session.participants),
                        participantCount: session.participants.size,
                        fileSize: mp3Stats.size,
                        fileUrl: uploadResult?.url,
                        status: uploadResult ? 'uploaded' : 'failed'
                    });
                }
            } catch (dbErr) {
                console.error('DB error updating recording:', dbErr.message);
            }

            // Clean up local MP3 file after upload
            if (uploadResult) {
                try { fs.unlinkSync(session.mp3Path); } catch (e) { }
            }

            console.log(`✅ Recording saved: ${this.formatDuration(duration)}, ${session.participants.size} participants`);

            this.activeRecordings.delete(guildId);

            return {
                duration,
                participants: session.participants.size,
                driveLink: uploadResult?.url
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
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '1',
                '-i', pcmPath,
                '-b:a', '128k',
                '-y',
                mp3Path
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
     * Handle voice state updates - auto-record if enabled
     */
    async handleVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const guildId = guild.id;

        // Only auto-record if enabled for this guild
        if (!this.isAutoRecordEnabled(guildId)) return;

        const isRecording = this.activeRecordings.has(guildId);

        // User joined a voice channel
        if (!oldState.channel && newState.channel && !newState.member.user.bot) {
            if (!isRecording) {
                await this.startRecording(newState.channel, guild);
            }
        }

        // User left a voice channel
        if (oldState.channel && !newState.channel) {
            if (isRecording) {
                const session = this.activeRecordings.get(guildId);
                if (session && session.voiceChannel) {
                    const members = session.voiceChannel.members.filter(m => !m.user.bot);
                    if (members.size === 0) {
                        await this.stopRecording(guildId);

                        // Check for another active VC
                        const otherVC = guild.channels.cache.find(c =>
                            c.type === 2 &&
                            c.id !== session.voiceChannel.id &&
                            c.members.filter(m => !m.user.bot).size > 0
                        );

                        if (otherVC) {
                            await this.startRecording(otherVC, guild);
                        }
                    }
                }
            }
        }

        // User switched channels
        if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            if (isRecording) {
                const session = this.activeRecordings.get(guildId);
                if (session && session.voiceChannel && session.voiceChannel.id === oldState.channel.id) {
                    const members = oldState.channel.members.filter(m => !m.user.bot);
                    if (members.size === 0) {
                        await this.stopRecording(guildId);
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

    isRecording(guildId) {
        return this.activeRecordings.has(guildId);
    }

    getRecordingInfo(guildId) {
        return this.activeRecordings.get(guildId);
    }
}

module.exports = VoiceRecorder;

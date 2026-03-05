// Voice Recorder - Captures, mixes, and saves voice channel audio
const {
    joinVoiceChannel,
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

class VoiceRecorder {
    constructor(client) {
        this.client = client;
        this.activeRecordings = new Map(); // guildId -> recording session
        this.pendingJoins = new Map(); // guildId -> channelId (tracks joining state to prevent race conditions)
        this.autoRecordEnabled = new Map(); // guildId -> boolean (default: false)
        this.silenceTimers = new Map(); // guildId -> timeout (auto-leave after silence)
        this.SILENCE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes of silence before auto-leave
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
        if (this.activeRecordings.has(guildId) || this.pendingJoins.has(guildId)) {
            console.log(`⚠️ Already recording or joining in guild ${guild.name}`);
            return null;
        }

        this.pendingJoins.set(guildId, voiceChannel.id);

        try {
            console.log(`🎙️ Attempting to join #${voiceChannel.name}...`);

            // Join the voice channel
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                group: this.client.user.id, // ISOLATE connection to the specific bot client
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
            this.pendingJoins.delete(guildId); // Connection complete, remove lock

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
            this.pendingJoins.delete(guildId);
            return session;

        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            this.activeRecordings.delete(guildId);
            this.pendingJoins.delete(guildId);
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
            let fileIoUrl = null;
            let uploadedToDiscord = false;

            try {
                const mp3Stats = fs.statSync(session.mp3Path);

                // 1. Try to send to Discord audio channel directly
                const audioChannel = session.guild.channels.cache.find(c => c.name === '👉audio👈' && c.isTextBased());

                if (audioChannel) {
                    try {
                        console.log(`☁️ Uploading MP3 to #👉audio👈 channel... (${mp3Stats.size} bytes)`);
                        const uploadFileName = `${session.guild.name}_${session.voiceChannel.name}_${new Date(session.startTime).toISOString().split('T')[0]}.mp3`;

                        // Resolve participant usernames
                        const participantList = [];
                        for (const participantId of session.participants) {
                            try {
                                const member = await session.guild.members.fetch(participantId);
                                participantList.push(`> <@${participantId}> (${member.user.tag})`);
                            } catch (e) {
                                participantList.push(`> <@${participantId}>`);
                            }
                        }

                        const fileSizeMB = (mp3Stats.size / (1024 * 1024)).toFixed(2);

                        const recordingEmbed = new EmbedBuilder()
                            .setColor(0xFF4500)
                            .setTitle('🎙️ Voice Recording Saved')
                            .setDescription(`A voice session in **#${session.voiceChannel.name}** has been recorded and saved.`)
                            .addFields(
                                {
                                    name: '📍 Voice Channel',
                                    value: `#${session.voiceChannel.name}`,
                                    inline: true
                                },
                                {
                                    name: '⏱️ Duration',
                                    value: this.formatDuration(duration),
                                    inline: true
                                },
                                {
                                    name: '📁 File Size',
                                    value: `${fileSizeMB} MB`,
                                    inline: true
                                },
                                {
                                    name: '🕐 Started At',
                                    value: `<t:${Math.floor(session.startTime / 1000)}:F>`,
                                    inline: true
                                },
                                {
                                    name: '🕐 Ended At',
                                    value: `<t:${Math.floor(endTime / 1000)}:F>`,
                                    inline: true
                                },
                                {
                                    name: '👥 Participant Count',
                                    value: `${session.participants.size} user(s)`,
                                    inline: true
                                },
                                {
                                    name: '🧑‍🤝‍🧑 Participants',
                                    value: participantList.length > 0 ? participantList.join('\n') : 'No participants detected',
                                    inline: false
                                }
                            )
                            .setFooter({ text: `${session.guild.name} • Voice Recorder Bot` })
                            .setTimestamp();

                        await audioChannel.send({
                            embeds: [recordingEmbed],
                            files: [{
                                attachment: session.mp3Path,
                                name: uploadFileName
                            }]
                        });
                        uploadedToDiscord = true;
                        console.log('✅ Successfully uploaded to #👉audio👈 channel');
                    } catch (discordUploadErr) {
                        console.error('❌ Discord Upload failed (File likely too large):', discordUploadErr.message);
                    }
                } else {
                    console.log('⚠️ Channel #👉audio👈 not found. Falling back to catbox.moe.');
                }

                // 2. Fallback to catbox.moe if Discord upload failed or channel was missing
                if (!uploadedToDiscord) {
                    const FileUploadService = require('../services/FileUploadService');
                    const uploadFileName = `${session.guild.name}_${session.voiceChannel.name}_${new Date(session.startTime).toISOString().split('T')[0]}.mp3`;

                    console.log('☁️ Uploading to catbox.moe...');
                    uploadResult = await FileUploadService.uploadFile(session.mp3Path, uploadFileName);
                    fileIoUrl = uploadResult?.url;

                    if (fileIoUrl && audioChannel) {
                        const fallbackEmbed = new EmbedBuilder()
                            .setColor(0xFFA500)
                            .setTitle('🎙️ Voice Recording (External Link)')
                            .setDescription(`Recording from **#${session.voiceChannel.name}** was too large for Discord.`)
                            .addFields(
                                { name: '⏱️ Duration', value: this.formatDuration(duration), inline: true },
                                { name: '👥 Participants', value: `${session.participants.size} user(s)`, inline: true },
                                { name: '🔗 Download Link', value: `[Click here to download](${fileIoUrl})`, inline: false }
                            )
                            .setFooter({ text: `${session.guild.name} • Voice Recorder Bot` })
                            .setTimestamp();

                        await audioChannel.send({ embeds: [fallbackEmbed] });
                    }
                }
            } catch (uploadErr) {
                console.error('❌ General Upload error:', uploadErr.message);
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
                        fileUrl: fileIoUrl || 'Discord Attachment',
                        status: (uploadedToDiscord || uploadResult) ? 'uploaded' : 'failed'
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
     * Handle voice state updates - auto-record on unmute (always active)
     * and auto-record on join (only if autoRecordEnabled)
     */
    async handleVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const guildId = guild.id;
        const isRecording = this.activeRecordings.has(guildId) || this.pendingJoins.has(guildId);

        // ═══════════════════════════════════════════════════════════════
        // ALWAYS ACTIVE: Auto-join when a user JOINS VC already unmuted
        // ═══════════════════════════════════════════════════════════════
        if (!oldState.channel && newState.channel && !newState.member.user.bot) {
            // Debug logging to see exactly what Discord sends
            console.log(`📋 [DEBUG] ${newState.member.user.tag} joined #${newState.channel.name} | selfMute: ${newState.selfMute} | selfDeaf: ${newState.selfDeaf} | serverMute: ${newState.serverMute} | serverDeaf: ${newState.serverDeaf}`);

            const isMuted = newState.selfMute || newState.serverMute || newState.selfDeaf || newState.serverDeaf;
            if (!isMuted && !isRecording) {
                console.log(`🎤 User ${newState.member.user.tag} joined #${newState.channel.name} already unmuted. Auto-joining to record!`);
                await this.startRecording(newState.channel, guild);
            } else if (!isMuted && isRecording) {
                console.log(`📋 [DEBUG] Already recording, skipping join for ${newState.member.user.tag}`);
            } else {
                console.log(`📋 [DEBUG] User ${newState.member.user.tag} joined muted/deafened. Waiting for unmute.`);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // ALWAYS ACTIVE: Auto-join when a user UNMUTES/UNDEAFENS in VC
        // ═══════════════════════════════════════════════════════════════
        if (oldState.channel && newState.channel && !newState.member.user.bot) {
            const wasSilent = oldState.selfMute || oldState.serverMute || oldState.selfDeaf || oldState.serverDeaf;
            const isSilent = newState.selfMute || newState.serverMute || newState.selfDeaf || newState.serverDeaf;

            // If they went from silent -> active
            if (wasSilent && !isSilent) {
                if (!isRecording) {
                    console.log(`🎤 User ${newState.member.user.tag} unmuted/undeafened in #${newState.channel.name}. Auto-joining to record!`);
                    await this.startRecording(newState.channel, guild);
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // ALWAYS ACTIVE: Check if everyone is muted → start silence timer
        // ═══════════════════════════════════════════════════════════════
        if (this.activeRecordings.has(guildId)) {
            const session = this.activeRecordings.get(guildId);
            if (session && session.voiceChannel) {
                const nonBotMembers = session.voiceChannel.members.filter(m => !m.user.bot);

                if (nonBotMembers.size > 0) {
                    const allMuted = nonBotMembers.every(m => m.voice.selfMute || m.voice.serverMute);

                    if (allMuted) {
                        // Start silence timer if not already running
                        if (!this.silenceTimers.has(guildId)) {
                            console.log(`🔇 All users muted in #${session.voiceChannel.name}. Starting ${this.SILENCE_TIMEOUT_MS / 1000}s silence timer...`);
                            const timer = setTimeout(async () => {
                                console.log(`⏰ Silence timeout reached for #${session.voiceChannel.name}. Auto-stopping recording and leaving.`);
                                this.silenceTimers.delete(guildId);
                                await this.stopRecording(guildId);
                            }, this.SILENCE_TIMEOUT_MS);
                            this.silenceTimers.set(guildId, timer);
                        }
                    } else {
                        // Someone is unmuted → cancel silence timer
                        if (this.silenceTimers.has(guildId)) {
                            console.log(`🔊 Someone unmuted in #${session.voiceChannel.name}. Cancelling silence timer.`);
                            clearTimeout(this.silenceTimers.get(guildId));
                            this.silenceTimers.delete(guildId);
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // ALWAYS ACTIVE: Handle leave/switch cleanup
        // ═══════════════════════════════════════════════════════════════

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

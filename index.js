// Discord Bot - Main Entry Point
require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pdf = require('pdf-parse');
const mongoose = require('mongoose');

// Import Models
const VCLog = require('./models/VCLog');
const VCStat = require('./models/VCStat');
const MessageStat = require('./models/MessageStat');
const Conversation = require('./models/Conversation');

// ═══════════════════════════════════════════════════════════════
// RENDER HOSTING FIX (Keep-Alive)
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Bot is online!'));
app.listen(port, () => console.log(`🌍 Web Server listening on port ${port} (Render Requirement)`));
// ═══════════════════════════════════════════════════════════════

// Connect to MongoDB
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log('🍃 Connected to MongoDB!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
} else {
    console.warn('⚠️ MONGO_URI not found in .env! Database features will fail.');
}

// Create the Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates, // Required for VC tracking
    ]
});

// Collection to store commands
client.commands = new Collection();
client.imageContexts = new Map(); // Store prompts for image regeneration

// ═══════════════════════════════════════════════════════════════
// VOICE CHANNEL TRACKING SYSTEM
// ═══════════════════════════════════════════════════════════════

// Store active VC sessions (in memory)
const activeSessions = new Map();

// Format duration
function formatDuration(ms) {
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

// Voice State Update Handler
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const userId = newState.member?.id || oldState.member?.id;
    const userName = newState.member?.user?.tag || oldState.member?.user?.tag;
    const guildId = newState.guild?.id || oldState.guild?.id;

    if (!userId || !guildId) return;

    const sessionKey = `${guildId}-${userId}`;

    // User joined a voice channel
    if (!oldState.channel && newState.channel) {
        const joinTime = Date.now();
        activeSessions.set(sessionKey, {
            userId,
            userName,
            channelId: newState.channel.id,
            channelName: newState.channel.name,
            guildId,
            joinTime
        });

        console.log(`🎙️ ${userName} joined VC: #${newState.channel.name}`);
    }

    // User left a voice channel
    else if (oldState.channel && !newState.channel) {
        const session = activeSessions.get(sessionKey);
        if (session) {
            const leaveTime = Date.now();
            const duration = leaveTime - session.joinTime;

            try {
                // 1. Save Log
                await VCLog.create({
                    userId,
                    userName,
                    channelId: session.channelId,
                    channelName: session.channelName,
                    guildId,
                    joinTime: session.joinTime,
                    leaveTime,
                    duration,
                    durationFormatted: formatDuration(duration)
                });

                // 2. Update Stats (Upsert)
                const update = {
                    $inc: {
                        totalTime: duration,
                        sessionCount: 1,
                        [`channelBreakdown.${session.channelId}.time`]: duration,
                        [`channelBreakdown.${session.channelId}.sessions`]: 1
                    },
                    $set: {
                        userName: userName,
                        [`channelBreakdown.${session.channelId}.name`]: session.channelName
                    }
                };

                await VCStat.updateOne(
                    { guildId, userId },
                    update,
                    { upsert: true }
                );

                console.log(`🔇 ${userName} left VC: #${oldState.channel.name} (${formatDuration(duration)})`);

            } catch (err) {
                console.error('Error saving VC data:', err);
            }

            activeSessions.delete(sessionKey);
        }
    }

    // User switched voice channels
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        // End old session
        const session = activeSessions.get(sessionKey);
        if (session) {
            const switchTime = Date.now();
            const duration = switchTime - session.joinTime;

            try {
                // Log old session
                await VCLog.create({
                    userId,
                    userName,
                    channelId: session.channelId,
                    channelName: session.channelName,
                    guildId,
                    joinTime: session.joinTime,
                    leaveTime: switchTime,
                    duration,
                    durationFormatted: formatDuration(duration),
                    switchedTo: newState.channel.name
                });

                // Update Stats
                const update = {
                    $inc: {
                        totalTime: duration,
                        sessionCount: 1,
                        [`channelBreakdown.${session.channelId}.time`]: duration,
                        [`channelBreakdown.${session.channelId}.sessions`]: 1
                    },
                    $set: {
                        userName: userName,
                        [`channelBreakdown.${session.channelId}.name`]: session.channelName
                    }
                };

                await VCStat.updateOne(
                    { guildId, userId },
                    update,
                    { upsert: true }
                );

            } catch (err) {
                console.error('Error saving switch data:', err);
            }
        }

        // Start new session
        activeSessions.set(sessionKey, {
            userId,
            userName,
            channelId: newState.channel.id,
            channelName: newState.channel.name,
            guildId,
            joinTime: Date.now()
        });

        console.log(`🔄 ${userName} switched: #${oldState.channel.name} → #${newState.channel.name}`);
    }
});

// Make Models accessible to commands
client.db = {
    VCLog,
    VCStat,
    MessageStat,
    Conversation,
    formatDuration,
    activeSessions
};

// ═══════════════════════════════════════════════════════════════
// COMMAND LOADING
// ═══════════════════════════════════════════════════════════════

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`✅ Loaded command: ${command.data.name}`);
        } else {
            console.log(`⚠️ Command at ${filePath} is missing required "data" or "execute" property.`);
        }
    }
}

// Bot ready event
client.once(Events.ClientReady, (readyClient) => {
    console.log('═══════════════════════════════════════════');
    console.log(`🤖 Bot is online!`);
    console.log(`📛 Logged in as: ${readyClient.user.tag}`);
    console.log(`🌐 Serving ${readyClient.guilds.cache.size} server(s)`);
    console.log(`🎙️ Voice channel tracking: ENABLED (MongoDB)`);
    console.log('═══════════════════════════════════════════');
});

// Handle slash command and button interactions
client.on(Events.InteractionCreate, async (interaction) => {
    // Handle regenerate button clicks
    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId.startsWith('regen_')) {
            await interaction.deferUpdate();

            const parts = customId.split('_');
            const provider = parts[1];
            const messageId = parts[2];

            // Get stored data (using memory for regen temporary data)
            const regenData = client.regenData?.get(messageId);
            if (!regenData) {
                await interaction.followUp({ content: '❌ Cannot regenerate - original message data expired.', ephemeral: true });
                return;
            }

            // Define provider configs
            const providers = {
                'openrouter': {
                    name: 'GPT-4o-mini',
                    url: 'https://openrouter.ai/api/v1/chat/completions',
                    key: process.env.OPENROUTER_API_KEY,
                    model: 'openai/gpt-4o-mini',
                    headers: { 'HTTP-Referer': 'https://discord.com', 'X-Title': 'Discord AI Chat Bot' }
                },
                'groq1': {
                    name: 'Groq Llama',
                    url: 'https://api.groq.com/openai/v1/chat/completions',
                    key: process.env.GROQ_API_KEY_1,
                    model: 'llama-3.3-70b-versatile',
                    headers: {}
                },
                'groq2': {
                    name: 'Groq Mixtral',
                    url: 'https://api.groq.com/openai/v1/chat/completions',
                    key: process.env.GROQ_API_KEY_2,
                    model: 'mixtral-8x7b-32768',
                    headers: {}
                }
            };

            const selectedProvider = providers[provider];
            if (!selectedProvider || !selectedProvider.key) {
                await interaction.followUp({ content: '❌ This provider is not configured.', ephemeral: true });
                return;
            }

            try {
                await interaction.followUp({ content: `🔄 Regenerating with **${selectedProvider.name}**...`, ephemeral: true });

                const response = await axios.post(
                    selectedProvider.url,
                    {
                        model: selectedProvider.model,
                        messages: [
                            {
                                role: 'system',
                                content: `You are a smart AI assistant in Discord. The user's name is ${regenData.userName}.
Be direct and helpful. ALWAYS use Discord markdown. Format code in triple backticks. Keep responses under 1800 chars.`
                            },
                            { role: 'user', content: regenData.originalContent }
                        ],
                        max_tokens: 1000,
                        temperature: 0.7
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${selectedProvider.key}`,
                            'Content-Type': 'application/json',
                            ...selectedProvider.headers
                        },
                        timeout: 30000
                    }
                );

                const newResponse = response.data.choices[0]?.message?.content;

                if (newResponse) {
                    const newRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`regen_openrouter_${messageId}`)
                                .setLabel('🔄 GPT')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`regen_groq1_${messageId}`)
                                .setLabel('🔄 Groq')
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(`regen_groq2_${messageId}`)
                                .setLabel('🔄 Llama')
                                .setStyle(ButtonStyle.Secondary)
                        );

                    const truncated = newResponse.length > 1900 ? newResponse.substring(0, 1900) + '...' : newResponse;
                    await interaction.message.edit({ content: `**[${selectedProvider.name}]**\n${truncated}`, components: [newRow] });
                }
            } catch (error) {
                console.error('Regeneration error:', error.message);
                await interaction.followUp({ content: '❌ Failed to regenerate. Try again!', ephemeral: true });
            }
            return;
        }

        // Handle Image Buttons
        if (customId.startsWith('img_')) {
            await interaction.deferUpdate();

            const parts = customId.split('_');
            const action = parts[1]; // 'regen' or 'enhance'
            const messageId = parts[2];

            const context = client.imageContexts.get(messageId);
            if (!context) {
                await interaction.followUp({ content: '❌ Image session expired.', ephemeral: true });
                return;
            }

            let prompt = context.prompt;

            // Enhance Logic
            if (action === 'enhance') {
                try {
                    await interaction.followUp({ content: '✨ Enhancing prompt with AI...', ephemeral: true });
                    // Use OpenRouter to enhance
                    const enhanceResponse = await axios.post(
                        'https://openrouter.ai/api/v1/chat/completions',
                        {
                            model: 'openai/gpt-4o-mini',
                            messages: [
                                { role: 'system', content: 'You are an expert AI art prompter. Rewrite the user\'s prompt to be highly detailed, artistic, and descriptive. Output ONLY the raw prompt. No quotes.' },
                                { role: 'user', content: prompt }
                            ]
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` } }
                    );
                    prompt = enhanceResponse.data.choices[0].message.content;
                    // Update context with new prompt for further regen
                    context.prompt = prompt;
                    client.imageContexts.set(messageId, context);
                } catch (e) {
                    console.error('Enhance failed', e);
                }
            }

            const encodedPrompt = encodeURIComponent(prompt);
            const seed = Math.floor(Math.random() * 1000000);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;

            const embed = new EmbedBuilder()
                .setTitle(`🎨 Generated Image: ${prompt.substring(0, 50)}...`) // Truncate title
                .setDescription(`**Prompt:** ${prompt.substring(0, 200)}`)
                .setImage(imageUrl)
                .setFooter({ text: `Powered by Pollinations.ai | Seed: ${seed}` });

            await interaction.message.edit({ embeds: [embed] });
            return;
        }
    }

    // Handle slash commands
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);

        const errorMessage = {
            content: '❌ There was an error while executing this command!',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

// Handle prefix commands AND track messages
const PREFIX = '!';

client.on(Events.MessageCreate, async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // ═══════════════════════════════════════════════════════════════
    // AI CHAT - Respond to messages in "ai-chat" channel
    // ═══════════════════════════════════════════════════════════════
    if (message.channel.name === '⭐⭐ai-chat⭐⭐') {
        // Show typing indicator
        await message.channel.sendTyping();

        const userId = message.author.id;
        const userName = message.author.username;

        // FETCH CONVERSATION FROM MONGODB
        let userConv;
        try {
            userConv = await Conversation.findOne({ userId });
            if (!userConv) {
                userConv = await Conversation.create({ userId, history: [] });
            }
        } catch (err) {
            console.error('DB Error fetching conversation:', err);
            // Fallback to empty history if DB fails
            userConv = { history: [] };
        }

        const userHistory = userConv.history.map(h => ({ role: h.role, content: h.content }));

        // ═══════════════════════════════════════════════════════════════
        // PDF ANALYSIS
        // ═══════════════════════════════════════════════════════════════
        // ... (PDF logic remains similar but pushes to DB history)

        // Helper to push to history and save
        const addToHistory = async (role, content) => {
            userHistory.push({ role, content });
            // Keep last 10
            if (userHistory.length > 10) userHistory.splice(0, userHistory.length - 10);

            try {
                if (userConv.save) { // Check if it's a Mongoose doc
                    userConv.history = userHistory;
                    userConv.lastUpdated = Date.now();
                    await userConv.save();
                }
            } catch (e) { console.error('Error saving conversation:', e); }
        };

        const hasPdf = message.attachments.some(att => att.contentType === 'application/pdf' || att.url?.endsWith('.pdf'));

        if (hasPdf) {
            // ... (PDF Logic - Keeping concise for rewrite, logic same as before)
            try {
                const pdfAttachment = message.attachments.find(att => att.contentType === 'application/pdf' || att.url?.endsWith('.pdf'));
                const pdfResponse = await axios.get(pdfAttachment.url, { responseType: 'arraybuffer', timeout: 60000 });
                const pdfData = await pdf(Buffer.from(pdfResponse.data));
                const pdfText = pdfData.text;

                if (!pdfText || pdfText.trim().length === 0) { await message.reply('❌ Could not extract text.'); return; }

                const truncatedText = pdfText.substring(0, 10000);
                const userPrompt = message.content || 'Summarize this PDF.';

                const analysisResponse = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    {
                        model: 'openai/gpt-4o-mini',
                        messages: [
                            { role: 'system', content: 'You are a helpful assistant that analyzes PDF documents.' },
                            { role: 'user', content: `${userPrompt}\n\n---PDF CONTENT---\n${truncatedText}` }
                        ],
                        max_tokens: 1500
                    },
                    { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }, timeout: 60000 }
                );

                const result = analysisResponse.data?.choices?.[0]?.message?.content;
                if (result) {
                    await message.reply(result.substring(0, 2000));
                }
            } catch (e) {
                console.error('PDF Error:', e.message);
                await message.reply('❌ Failed to analyze PDF.');
            }
            return;
        }

        // ═══════════════════════════════════════════════════════════════
        // GITHUB LINK ANALYSIS
        // ═══════════════════════════════════════════════════════════════
        const githubFileRegex = /https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(\S+)/;
        const githubRepoRegex = /https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\s|$|\/)/;

        const fileMatch = message.content.match(githubFileRegex);
        const repoMatch = message.content.match(githubRepoRegex);

        if (fileMatch || repoMatch) {
            try {
                let codeContent = '';
                let contextType = '';

                if (fileMatch) {
                    const [, owner, repo, branch, filePath] = fileMatch;
                    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
                    const response = await axios.get(rawUrl, { responseType: 'text', timeout: 10000 });
                    codeContent = response.data;
                    contextType = `File: ${filePath}`;
                } else if (repoMatch) {
                    const [, owner, repo] = repoMatch;
                    const branches = ['main', 'master'];
                    for (const branch of branches) {
                        try {
                            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
                            const response = await axios.get(rawUrl, { responseType: 'text', timeout: 5000 });
                            codeContent = response.data;
                            contextType = `Repository: ${owner}/${repo} (README)`;
                            break;
                        } catch (e) { continue; }
                    }
                }

                if (codeContent) {
                    if (typeof codeContent !== 'string') codeContent = JSON.stringify(codeContent);
                    const truncatedCode = codeContent.substring(0, 4000);

                    await addToHistory('system', `[Context] The user provided a GitHub link. Here is the content of ${contextType}:\n\`\`\`\n${truncatedCode}\n\`\`\``);

                    const analysisResponse = await axios.post(
                        'https://openrouter.ai/api/v1/chat/completions',
                        {
                            model: 'openai/gpt-4o-mini',
                            messages: [
                                { role: 'system', content: 'You are an expert coder. Analyze the provided code/repo content.' },
                                { role: 'user', content: `Analyze this ${contextType}:\n${truncatedCode}\n\nUser Question: ${message.content}` }
                            ],
                            max_tokens: 1500
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` } }
                    );

                    const result = analysisResponse.data?.choices?.[0]?.message?.content;
                    if (result) {
                        await message.reply(result.substring(0, 2000));
                        await addToHistory('assistant', result);
                    }
                    return;
                }
            } catch (e) {
                console.error('GitHub Analysis Error:', e.message);
                await message.reply('❌ I could not read that GitHub link. Is the repo private or the file too large?');
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // IMAGE ANALYSIS
        // ═══════════════════════════════════════════════════════════════
        const imageAttachment = message.attachments.find(att => att.contentType?.startsWith('image/'));
        if (imageAttachment) {
            try {
                const visionResponse = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    {
                        model: 'openai/gpt-4o-mini',
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: message.content || 'Analyze this image.' },
                                    { type: 'image_url', image_url: { url: imageAttachment.url } }
                                ]
                            }
                        ]
                    },
                    { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` } }
                );
                const description = visionResponse.data?.choices?.[0]?.message?.content;
                if (description) {
                    await addToHistory('system', `[Image Context]: User uploaded an image. Analysis: ${description}`);
                    await message.reply(description);
                    await addToHistory('assistant', description);
                    return;
                }
            } catch (e) { console.error('Image Analysis Error', e); }
        }

        // Add current message to user's history
        await addToHistory('user', message.content);

        // Check for Image Generation
        const lowerContent = message.content.toLowerCase();
        // ... (Regex logic) ...
        const wantsImage = lowerContent.startsWith('imagine ') || /generate .* image/i.test(message.content); // Simplified regex for rewrite safety, ideally use full regex

        if (wantsImage) {
            const prompt = message.content.replace(/^imagine\s+/i, '').replace(/generate .* image/i, '').trim();
            if (!prompt) return message.reply('❌ Please provide a prompt!');

            const encodedPrompt = encodeURIComponent(prompt);
            const seed = Math.floor(Math.random() * 1000000);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;

            const embed = new EmbedBuilder()
                .setTitle(`🎨 Generated Image: ${prompt}`)
                .setImage(imageUrl)
                .setFooter({ text: `Powered by Pollinations.ai | Seed: ${seed}` });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`img_regen_${message.id}`)
                        .setLabel('🔄 Regenerate')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`img_enhance_${message.id}`)
                        .setLabel('✨ Enhance')
                        .setStyle(ButtonStyle.Primary)
                );

            const reply = await message.reply({ embeds: [embed], components: [row] });

            // Save context using reply ID (or original message ID? Logic uses message.id in customId, so we map message.id)
            // Wait, interaction returns the reply message's interaction.message. 
            // Better to use the REPLY's ID if we edit the reply. 
            // But we don't know reply ID until SENT.
            // Actually, we can use the original message ID in the CustomID, and map Original -> Context.
            // But when editing, `interaction.message` is the BOT's reply. 
            // So we should map BOT's REPLY ID? 
            // No, CustomID is constant. 
            // I'll use `message.id` (User's message ID) as the key.
            client.imageContexts.set(message.id, { prompt, userId: message.author.id });

            return;
        }

        // ═══════════════════════════════════════════════════════════════
        // TEXT CHAT (Gemini/Groq/OpenAI)
        // ═══════════════════════════════════════════════════════════════

        // Define API providers
        const apiProviders = [
            {
                name: 'OpenRouter',
                url: 'https://openrouter.ai/api/v1/chat/completions',
                key: process.env.OPENROUTER_API_KEY,
                model: 'openai/gpt-4o-mini',
                headers: { 'HTTP-Referer': 'https://discord.com', 'X-Title': 'Discord AI Chat Bot' }
            },
            {
                name: 'Groq-1',
                url: 'https://api.groq.com/openai/v1/chat/completions',
                key: process.env.GROQ_API_KEY_1,
                model: 'llama-3.3-70b-versatile',
                headers: {}
            },
            {
                name: 'Groq-2',
                url: 'https://api.groq.com/openai/v1/chat/completions',
                key: process.env.GROQ_API_KEY_2,
                model: 'llama-3.3-70b-versatile',
                headers: {}
            },
            {
                name: 'Gemini',
                url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
                key: process.env.GEMINI_API_KEY,
                model: 'gemini-1.5-flash',
                type: 'gemini',
                headers: {}
            }
        ];

        let aiResponse = null;
        let usedProvider = null;

        for (const provider of apiProviders) {
            if (!provider.key) continue;

            try {
                let requestUrl = provider.url;
                let requestBody;

                if (provider.type === 'gemini') {
                    // Gemini Logic
                    requestUrl = `${provider.url}?key=${provider.key}`;
                    const geminiContents = [];
                    const systemPrompt = `You are a smart AI assistant. User: ${userName}. ALWAYS use Discord Markdown. Format code with \`\`\`.`;

                    let isFirst = true;
                    for (const msg of userHistory) {
                        const role = msg.role === 'assistant' ? 'model' : 'user';
                        let text = msg.content;
                        if (isFirst && role === 'user') { text = systemPrompt + '\n\n' + text; isFirst = false; }
                        geminiContents.push({ role, parts: [{ text }] });
                    }
                    if (isFirst) geminiContents.push({ role: 'user', parts: [{ text: systemPrompt + '\n\nHello' }] });

                    requestBody = { contents: geminiContents };
                } else {
                    // OpenAI Logic
                    requestBody = {
                        model: provider.model,
                        messages: [
                            { role: 'system', content: `You are a smart AI assistant. User: ${userName}. ALWAYS use Discord Markdown. Format code with \`\`\`.` },
                            ...userHistory
                        ],
                        max_tokens: 1000
                    };
                }

                const response = await axios.post(
                    requestUrl,
                    requestBody,
                    {
                        headers: {
                            ...(provider.type !== 'gemini' ? { 'Authorization': `Bearer ${provider.key}` } : {}),
                            'Content-Type': 'application/json',
                            ...provider.headers
                        },
                        timeout: 30000
                    }
                );

                if (provider.type === 'gemini') {
                    aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                } else {
                    aiResponse = response.data.choices[0]?.message?.content;
                }

                usedProvider = provider.name;
                if (aiResponse) break;

            } catch (err) {
                console.log(`${provider.name} failed:`, err.message);
                continue;
            }
        }

        if (aiResponse) {
            await addToHistory('assistant', aiResponse);

            if (aiResponse.length > 2000) {
                const chunks = aiResponse.match(/.{1,1990}/gs) || [];
                for (const chunk of chunks) await message.reply(chunk);
            } else {
                await message.reply(aiResponse);
            }
        } else {
            await message.reply('❌ All AI providers failed.');
        }

    }

    // ═══════════════════════════════════════════════════════════════
    // MESSAGE TRACKING (MongoDB)
    // ═══════════════════════════════════════════════════════════════
    if (message.guild) {
        try {
            const update = {
                $inc: {
                    totalMessages: 1,
                    [`channelBreakdown.${message.channel.id}.count`]: 1
                },
                $set: {
                    userName: message.author.tag,
                    lastActive: Date.now(),
                    [`channelBreakdown.${message.channel.id}.name`]: message.channel.name
                }
            };

            await MessageStat.updateOne(
                { guildId: message.guild.id, userId: message.author.id },
                update,
                { upsert: true }
            );
        } catch (err) {
            console.error('Error saving message stats:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PREFIX COMMANDS
    // ═══════════════════════════════════════════════════════════════
    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (commandName === 'ping') message.reply('Pong!');
    if (commandName === 'help') message.reply('Use slash commands!');
});

// Login
client.login(process.env.DISCORD_TOKEN);
// Force Render Redeploy

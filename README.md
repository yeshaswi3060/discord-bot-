# Discord Bot 🤖

A Discord bot built with Node.js and discord.js v14.

## Setup Instructions

### 1. Get Your Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application (ID: `1454512743347523758`)
3. Go to **Bot** tab on the left
4. Click **Reset Token** (or **View Token** if available)
5. Copy the token

### 2. Configure Environment

Open `.env` file and update these values:

```env
DISCORD_TOKEN=paste_your_bot_token_here
CLIENT_ID=1454512743347523758
GUILD_ID=1352260592546615457
```

### 3. Invite Bot to Server

Use this URL to invite your bot (replace permissions as needed):
```
https://discord.com/api/oauth2/authorize?client_id=1454512743347523758&permissions=8&scope=bot%20applications.commands
```

### 4. Run the Bot

```bash
# Deploy slash commands first (required once)
npm run deploy

# Start the bot
npm start

# Or do both at once
npm run dev
```

## Available Commands

### Slash Commands (/)
| Command | Description |
|---------|-------------|
| `/ping` | Check bot latency |
| `/userinfo` | Get info about a user |
| `/serverinfo` | Get server statistics |
| `/avatar` | Get a user's avatar |

### Prefix Commands (!)
| Command | Description |
|---------|-------------|
| `!ping` | Check bot latency |
| `!hello` | Get a greeting |
| `!help` | Show available commands |

## Project Structure

```
DC bot/
├── index.js          # Main bot entry point
├── deploy-commands.js # Script to register slash commands
├── commands/         # Slash command files
│   ├── ping.js
│   ├── userinfo.js
│   ├── serverinfo.js
│   └── avatar.js
├── .env              # Your bot credentials (keep secret!)
└── .env.example      # Example environment file
```

## Adding New Commands

1. Create a new file in `commands/` folder
2. Follow this template:

```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commandname')
        .setDescription('Command description'),
    
    async execute(interaction) {
        await interaction.reply('Hello!');
    },
};
```

3. Run `npm run deploy` to register the new command

## Need Help?

- [discord.js Documentation](https://discord.js.org/)
- [Discord Developer Portal](https://discord.com/developers/docs)

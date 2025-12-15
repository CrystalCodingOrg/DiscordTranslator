# Message Translator Discord Bot

A Discord bot that translates messages using Google's Gemini AI. Supports both context menu commands and slash commands for easy message translation.

## Features

- 🌍 **Context Menu Translation**: Right-click any message to translate it
- ⌨️ **Slash Command**: Use `/translate` to translate custom text
- 🤖 **Powered by Gemini AI**: Advanced language detection and translation
- 🐳 **Docker Ready**: Easy deployment with Docker and Docker Compose
- 🔒 **Secure**: Input sanitization and proper error handling
- ✅ **Health Checks**: Built-in health monitoring for container orchestration

## Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0 or higher)
- Discord Bot Application ([Create one here](https://discord.com/developers/applications))
- Google Gemini API Key ([Get one here](https://ai.google.dev/))
- Docker and Docker Compose (for containerized deployment)

## Setup

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd message_translator
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```env
# Discord Bot Configuration
APP_ID=your_discord_app_id
DISCORD_TOKEN=your_discord_bot_token
PUBLIC_KEY=your_discord_public_key

# Optional: For instant testing in a specific guild
DEV_GUILD_ID=your_development_guild_id

# Google AI Configuration
GEMINI_API_KEY=your_google_genai_api_key
```

#### Getting Discord Credentials

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Go to the "Bot" section to get your `DISCORD_TOKEN`
4. Go to "General Information" to get your `APP_ID` and `PUBLIC_KEY`
5. Enable the "Message Content Intent" in the Bot settings

#### Getting Google Gemini API Key

1. Visit [Google AI Studio](https://ai.google.dev/)
2. Sign in with your Google account
3. Create a new API key
4. Copy the key to your `.env` file

### 4. Register Discord Commands

The bot automatically registers commands on startup. Commands include:

- **Translate Message** (Context Menu): Right-click on any message
- **/translate** (Slash Command): Translate custom text

Commands are registered globally and may take up to 1 hour to propagate. If you set `DEV_GUILD_ID`, they'll also be registered instantly in that specific guild for testing.

## Running the Bot

### Local Development

```bash
# Run with auto-reload
bun run dev

# Or run normally
bun run start
```

The server will start on `http://0.0.0.0:3000`

### Docker Deployment

#### Using Docker Compose (Recommended)

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

#### Using Docker Directly

```bash
# Build the image
docker build -t message-translator .

# Run the container
docker run -d \
  --name message-translator \
  -p 3000:3000 \
  --env-file .env \
  message-translator
```

## Discord Bot Configuration

### Setting the Interactions Endpoint URL

1. Go to your application in the [Discord Developer Portal](https://discord.com/developers/applications)
2. Navigate to "General Information"
3. Set the "Interactions Endpoint URL" to your public URL (e.g., `https://your-domain.com`)
4. Discord will send a POST request to verify the endpoint

**Important**: Your bot must be publicly accessible for Discord to send interactions. Consider using:
- A VPS or cloud hosting service
- [ngrok](https://ngrok.com/) for local development testing
- Reverse proxy (nginx, Caddy) for production

### Bot Permissions

When inviting the bot to your server, ensure it has:
- `applications.commands` scope
- No special permissions required (bot responds with ephemeral messages)

Invite URL format:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=applications.commands
```

## Usage

### Context Menu Command

1. Right-click (or long-press on mobile) any message
2. Select "Apps" → "Translate Message"
3. The bot will detect the language and translate it to English

### Slash Command

```
/translate message:"Hello, how are you?" language:"spanish"
```

The bot will translate the provided text to the specified language.

## Project Structure

```
message_translator/
├── src/
│   ├── index.ts       # Main server and Discord interaction handler
│   ├── gemini.ts      # Google Gemini AI translation logic
│   └── register.ts    # Discord command registration
├── .github/
│   └── workflows/
│       └── docker-build.yml  # CI/CD for building Docker images
├── Dockerfile         # Multi-stage Docker build
├── docker-compose.yml # Docker Compose configuration
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── .env.example       # Environment variable template
└── README.md         # This file
```

## Health Check

The bot includes a health check endpoint at `/health` that returns:

```json
{
  "status": "ok",
  "timestamp": "2025-12-15T10:30:00.000Z"
}
```

This is used by Docker's health check system to monitor the container.

## Security Features

- ✅ Discord signature verification for all incoming requests
- ✅ Input sanitization to prevent prompt injection attacks
- ✅ Character limits on user inputs (2000 chars for messages, 50 for language)
- ✅ Environment variable validation on startup
- ✅ Proper error handling with user-friendly error messages

## Troubleshooting

### Commands not showing up in Discord

- Wait up to 1 hour for global commands to propagate
- Use `DEV_GUILD_ID` for instant testing in a specific server
- Check bot logs for registration errors

### "Invalid request signature" errors

- Verify your `PUBLIC_KEY` is correct in `.env`
- Ensure your public URL is correctly set in Discord Developer Portal

### Translation failures

- Check that `GEMINI_API_KEY` is valid
- Verify you haven't exceeded Google AI API quotas
- Check container logs: `docker-compose logs -f`

### Container health check failing

- Ensure port 3000 is accessible
- Check if curl is available in the container
- View health status: `docker inspect message-translator`

## GitHub Actions CI/CD

This project includes a GitHub Actions workflow that:

- Builds multi-platform Docker images (linux/amd64, linux/arm64)
- Pushes to GitHub Container Registry (ghcr.io)
- Runs on pushes to main/master and on tags
- Creates build attestations for supply chain security

To use it:

1. Enable GitHub Actions in your repository
2. Ensure GitHub Packages write permissions are enabled
3. Push to main branch or create a version tag (e.g., `v1.0.0`)

Images are available at: `ghcr.io/<username>/message_translator:latest`

## Development

### Running Tests

```bash
# No tests configured yet
# Add your test commands here
```

### Code Style

The project uses TypeScript with strict mode enabled. Run type checking:

```bash
bun run tsc --noEmit
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source. Add your preferred license here.

## Support

For issues and questions:
- Open an issue on GitHub
- Check the [Discord Developer Documentation](https://discord.com/developers/docs)
- Review [Google Gemini API Documentation](https://ai.google.dev/docs)

## Acknowledgments

- Built with [Bun](https://bun.sh/)
- Powered by [Google Gemini AI](https://ai.google.dev/)
- Discord integration via [discord.js](https://discord.js.org/)

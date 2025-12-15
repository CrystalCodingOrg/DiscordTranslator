import { REST, Routes, ApplicationCommandType, InteractionContextType } from "discord.js";

const APP_ID = process.env.APP_ID!;
const TOKEN = process.env.DISCORD_TOKEN!;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID; // optional for instant testing

export async function register() {
    if (!APP_ID || !TOKEN) {
        console.error("Missing APP_ID or DISCORD_TOKEN in environment");
        return;
    }

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    const commands = [
        {
            name: "Translate Message",
            type: ApplicationCommandType.Message, // Message context menu
            contexts: [InteractionContextType.Guild, InteractionContextType.PrivateChannel]
        },
        // Slash command variant: /translate
        {
            name: "translate",
            type: 1, // Chat Input
            description: "Translate a provided message into the specified language",
            default_member_permissions: 0x00000008, // ADMINISTRATOR permission
            contexts: [InteractionContextType.Guild, InteractionContextType.PrivateChannel],
            options: [
                {
                    name: "message",
                    description: "The message text to translate",
                    type: 3, // STRING
                    required: true,
                },
                {
                    name: "language",
                    description: "Target language (e.g. english, spanish)",
                    type: 3, // STRING
                    required: true,
                },
            ],
        }
    ];

    try {
        // If DEV_GUILD_ID is provided, register there for instant testing
        if (DEV_GUILD_ID) {
            console.log(`Registering commands for dev guild ${DEV_GUILD_ID} (for testing)...`);
            await rest.put(Routes.applicationGuildCommands(APP_ID, DEV_GUILD_ID), {
                body: commands,
            });
            console.log("✅ Commands registered for dev guild!");
            // Also attempt to register globally so commands are available in DMs and other guilds.
            console.log("Also registering globally to enable usage in DMs and other guilds...");
            await rest.put(Routes.applicationCommands(APP_ID), {
                body: commands,
            });
            console.log("✅ Global commands registered (alongside dev guild)!");
            console.log(
                "⚠️ Note: Global commands can take up to 1 hour to propagate"
            );
        } else {
            // No dev guild: register globally (required for DMs)
            console.log("Registering global commands...");
            await rest.put(Routes.applicationCommands(APP_ID), {
                body: commands,
            });
            console.log("✅ Global commands registered!");
            console.log(
                "⚠️ Note: Global commands can take up to 1 hour to propagate"
            );
        }
    } catch (error) {
        console.error("Failed to register commands:", error);
    }
}

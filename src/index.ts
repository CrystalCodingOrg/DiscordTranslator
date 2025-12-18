import nacl from "tweetnacl";
import { register } from "./register";
import { translate } from "./gemini";
import { initMySQLPool, initDatabase, getUserStats, deleteUserData, getUserTranslationHistory } from "./mysql";

// Debug logging helper
const DEBUG_MODE = process.env.DEBUG_MODE === "1";
function debug(...args: any[]) {
  if (DEBUG_MODE) {
    console.log("[DEBUG]", ...args);
  }
}

// Validate required environment variables
function validateEnv() {
  const required = [
    "PUBLIC_KEY",
    "APP_ID",
    "DISCORD_TOKEN",
    "GEMINI_API_KEY"
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }
  
  console.log("✅ All required environment variables are set");
  debug("DEBUG_MODE is enabled");
}

validateEnv();

// Initialize MySQL
initMySQLPool();
await initDatabase();

const PUB_KEY = process.env.PUBLIC_KEY!;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
await register();

// Helper: send deferred response (acknowledge immediately, respond later)
function deferResponse(ephemeral: boolean = true) {
  return new Response(
    JSON.stringify({
      type: 5, // DeferredChannelMessageWithSource
      data: {
        flags: ephemeral ? 64 : 0, // ephemeral flag
      },
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// Helper: send follow-up message
async function sendFollowUp(interactionToken: string, data: any) {
  const url = `https://discord.com/api/v10/webhooks/${process.env.APP_ID}/${interactionToken}`;
  
  debug("Sending follow-up message:", { url, data });
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${DISCORD_TOKEN}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      console.error("Failed to send follow-up:", await response.text());
    } else {
      debug("Follow-up sent successfully");
    }
  } catch (error) {
    console.error("Error sending follow-up:", error);
  }
}

// Helper: send ephemeral response (immediate response)
function sendEphemeral(data: any) {
  return new Response(
    JSON.stringify({
      type: 4, // ChannelMessageWithSource
      data: {
        ...data,
        flags: 64, // ephemeral
      },
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// Command handler type
type CommandHandler = (data: any) => Promise<Response>;

// Command handlers registry
const commandHandlers: Record<string, CommandHandler> = {
  "translate_message": async (data) => {
    const interactionToken = data.token;
    const userId = data.member?.user?.id || data.user?.id;
    const username = data.member?.user?.username || data.user?.username;
    debug("translate_message command received:", { targetId: data.data?.target_id, userId, username });
    
    // Defer the response immediately
    setTimeout(async () => {
      try {
        const message = data.data?.resolved?.messages?.[data.data.target_id];

        if (!message) {
          debug("Message not found in resolved data");
          await sendFollowUp(interactionToken, { 
            content: "Message not found ❌",
            flags: 64 // ephemeral
          });
          return;
        }

        debug("Translating message:", message.content);
        const translation = await translate(message.content, "english", userId, username);
        debug("Translation result:", translation);

        const embed = {
          title: translation.from_cache ? "Translation (from cache ✨)" : "Translation",
          color: translation.from_cache ? 0x3498db : 0x1abc9c,
          fields: [
            { name: "Original Message", value: translation.original_message || "N/A" },
            { name: "Detected Language", value: translation.detected_language || "N/A" },
            { name: "Translated Message", value: translation.translated_message || "N/A" },
          ],
        };

        await sendFollowUp(interactionToken, { 
          embeds: [embed],
          flags: 64 // ephemeral
        });
      } catch (error) {
        console.error("Error in translate_message command:", error);
        await sendFollowUp(interactionToken, { 
          content: "❌ Translation failed. Please try again later.",
          flags: 64 // ephemeral
        });
      }
    }, 0);

    return deferResponse(true); // Acknowledge immediately with ephemeral
  },
  // Slash command: /translate
  "translate": async (data) => {
    const interactionToken = data.token;
    const userId = data.member?.user?.id || data.user?.id;
    const username = data.member?.user?.username || data.user?.username;
    debug("translate command received", { userId, username });

    // Defer the response immediately
    setTimeout(async () => {
      try {
        const messageText = data.data?.options?.find((o: any) => o.name === "message")?.value;
        const language = data.data?.options?.find((o: any) => o.name === "language")?.value;

        debug("Translate options:", { messageText, language });

        if (!messageText) {
          await sendFollowUp(interactionToken, { 
            content: "No message provided ❌",
            flags: 64 // ephemeral
          });
          return;
        }
        if (!language) {
          await sendFollowUp(interactionToken, { 
            content: "No language provided ❌",
            flags: 64 // ephemeral
          });
          return;
        }

        debug("Translating to", language);
        const translation = await translate(messageText, language, userId, username);
        debug("Translation result:", translation);

        const embed = {
          title: translation.from_cache ? `Translation (${language}) - from cache ✨` : `Translation (${language})`,
          color: translation.from_cache ? 0x3498db : 0x1abc9c,
          fields: [
            { name: "Original Message", value: translation.original_message || "N/A" },
            { name: "Detected Language", value: translation.detected_language || "N/A" },
            { name: "Translated Message", value: translation.translated_message || "N/A" },
          ],
        };

        await sendFollowUp(interactionToken, { 
          content: translation.translated_message, 
          embeds: [embed],
          flags: 64 // ephemeral
        });
      } catch (error) {
        console.error("Error in translate command:", error);
        await sendFollowUp(interactionToken, { 
          content: "❌ Translation failed. Please try again later.",
          flags: 64 // ephemeral
        });
      }
    }, 0);

    return deferResponse(true); // Acknowledge immediately with ephemeral
  },
};

const commandAliases: Record<string, string> = {
  "Translate Message": "translate_message"
}

const server = Bun.serve({
  port: 3000,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Privacy policy endpoint
    if (url.pathname === "/privacy") {
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - Discord Translator</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #5865F2;
            border-bottom: 3px solid #5865F2;
            padding-bottom: 10px;
        }
        h2 {
            color: #4752C4;
            margin-top: 30px;
        }
        .highlight {
            background: #fef3cd;
            padding: 15px;
            border-left: 4px solid #f0b429;
            margin: 20px 0;
        }
        ul {
            margin: 10px 0;
        }
        li {
            margin: 8px 0;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 Privacy Policy & Data Usage</h1>
        
        <div class="highlight">
            <strong>⚠️ By using this Discord translation service, you agree to the data collection and storage described below.</strong>
        </div>

        <h2>📝 What Data We Collect & Store</h2>
        <p>When you use our translation service, we automatically collect and store:</p>
        <ul>
            <li><strong>Discord User ID:</strong> Your unique Discord identifier (numeric ID)</li>
            <li><strong>Username:</strong> Your Discord username at the time of translation</li>
            <li><strong>Original Messages:</strong> The full text of messages you submit for translation</li>
            <li><strong>Message Hashes:</strong> SHA-256 hashes of original messages for efficient caching</li>
            <li><strong>Translated Messages:</strong> The complete translated output</li>
            <li><strong>Target Languages:</strong> Which languages you request translations into</li>
            <li><strong>Detected Languages:</strong> The source language detected by our AI</li>
            <li><strong>Timestamps:</strong> When each translation was created and last accessed</li>
            <li><strong>Usage Counts:</strong> How many times each cached translation has been reused</li>
        </ul>

        <h2>🎯 Why We Collect This Data</h2>
        <ul>
            <li><strong>Performance Caching:</strong> Store frequently translated messages to provide instant responses without re-processing</li>
            <li><strong>Service Improvement:</strong> Analyze translation patterns and usage to improve service quality</li>
            <li><strong>Cost Optimization:</strong> Reduce API calls to translation services by reusing cached results</li>
            <li><strong>User Tracking:</strong> Link translations to users for accountability and usage analytics</li>
        </ul>

        <h2>🗄️ How Long We Store Data</h2>
        <p>Translation data is stored:</p>
        <ul>
            <li><strong>Indefinitely</strong> for frequently used translations (use_count > 1)</li>
            <li><strong>90+ days</strong> for single-use translations (may be periodically cleaned)</li>
            <li>User profiles remain until you request deletion</li>
        </ul>

        <h2>🔗 Data Sharing</h2>
        <p>Your data is shared with:</p>
        <ul>
            <li><strong>Google Gemini API:</strong> Original messages are sent to Google's AI service for translation processing</li>
            <li><strong>No other third parties:</strong> We do not sell or share your data with advertisers or other services</li>
        </ul>

        <h2>🛡️ Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
            <li><strong>Access:</strong> Request information about what data we have stored about you</li>
            <li><strong>Deletion:</strong> Request complete deletion of your user profile and translation history</li>
        </ul>
        <p><em>Note: Due to caching, translations may remain in shared cache but will no longer be linked to your user ID.</em></p>

        <h2>⚙️ Database Structure</h2>
        <p>Your data is stored in the following tables:</p>
        <ul>
            <li><strong>discord_user:</strong> Your Discord ID and username</li>
            <li><strong>translation_history:</strong> All translation messages and metadata</li>
            <li><strong>history:</strong> Links between your user ID and your translations</li>
        </ul>

        <div class="footer">
            <p><strong>Last Updated:</strong> December 18, 2025</p>
            <p><strong>Contact:</strong> If you have questions or wish to exercise your data rights, please contact the administrator at <a href="mailto:crystal@crystalcoding.org">crystal@crystalcoding.org</a></p>
        </div>
    </div>
</body>
</html>
      `;
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (req.method !== "POST") return new Response(null, { status: 405 });

    const signature = req.headers.get("X-Signature-Ed25519");
    const timestamp = req.headers.get("X-Signature-Timestamp");
    const body = await req.text();

    debug("Incoming request:", { signature: signature?.substring(0, 16) + "...", timestamp, bodyLength: body.length });

    if (!signature || !timestamp) {
      debug("Missing signature or timestamp");
      return new Response(null, { status: 400 });
    }

    const isVerified = nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, "hex"),
      Buffer.from(PUB_KEY, "hex")
    );

    if (!isVerified) {
      debug("Signature verification failed");
      return new Response("invalid request signature", { status: 401 });
    }

    const data = JSON.parse(body);
    debug("Request verified, type:", data.type);

    // PING
    if (data.type === 1) {
      debug("Received PING request");
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle commands
    if (data.type === 2) {
      const commandName = data.data?.name; // Discord sends the command name
      const handler = commandHandlers[commandName] ?? commandHandlers[commandAliases[commandName] ?? ""];

      if (handler) {
        console.log("Processing " + commandName);
        debug("Full interaction data:", JSON.stringify(data, null, 2));
        
        return handler(data);
      } else {
        debug("No handler found for command:", commandName);
      }
    }

    debug("Unhandled request type:", data.type);
    return new Response(null, { status: 404 });
  },
});

console.log(`Running at ${server.url}`);

process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  server.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  server.stop(true);
  process.exit(0);
});

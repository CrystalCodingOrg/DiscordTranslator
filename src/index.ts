import nacl from "tweetnacl";
import { register } from "./register";
import { translate } from "./gemini";
import { initMySQLPool, initDatabase } from "./mysql";

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
    debug("translate_message command received:", { targetId: data.data?.target_id });
    
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
        const translation = await translate(message.content);
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
    debug("translate command received");

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
        const translation = await translate(messageText, language);
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

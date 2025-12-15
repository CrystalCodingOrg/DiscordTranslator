import nacl from "tweetnacl";
import { register } from "./register";
import { translate } from "./gemini";

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
}

validateEnv();

const PUB_KEY = process.env.PUBLIC_KEY!;
await register();

// Helper: send ephemeral response
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
    try {
      const message = data.data?.resolved?.messages?.[data.data.target_id];

      if (!message) {
        return sendEphemeral({ content: "Message not found ❌" });
      }

      // console.log("=== Log Message Context Menu ===");
      // console.log("Message content:", message.content);

      const translation = await translate(message.content);

      const embed = {
        title: "Translation",
        color: 0x1abc9c,
        fields: [
          { name: "Original Message", value: translation.original_message || "N/A" },
          { name: "Detected Language", value: translation.detected_language || "N/A" },
          { name: "Translated Message", value: translation.translated_message || "N/A" },
        ],
      };

      return sendEphemeral({ embeds: [embed] });
    } catch (error) {
      console.error("Error in translate_message command:", error);
      return sendEphemeral({ 
        content: "❌ Translation failed. Please try again later." 
      });
    }
  },
  // Slash command: /translate
  "translate": async (data) => {
    try {
      const messageText = data.data?.options?.find((o: any) => o.name === "message")?.value;
      const language = data.data?.options?.find((o: any) => o.name === "language")?.value;

      if (!messageText) {
        return sendEphemeral({ content: "No message provided ❌" });
      }
      if (!language) {
        return sendEphemeral({ content: "No language provided ❌" });
      }

      // console.log("=== Slash Translate Command ===");
      // console.log("Message to translate:", messageText);
      // console.log("Target language:", language);

      const translation = await translate(messageText, language);

      const embed = {
        title: `Translation (${language})`,
        color: 0x1abc9c,
        fields: [
          { name: "Original Message", value: translation.original_message || "N/A" },
          { name: "Detected Language", value: translation.detected_language || "N/A" },
          { name: "Translated Message", value: translation.translated_message || "N/A" },
        ],
      };

      return sendEphemeral({ content: translation.translated_message, embeds: [embed] });
    } catch (error) {
      console.error("Error in translate command:", error);
      return sendEphemeral({ 
        content: "❌ Translation failed. Please try again later." 
      });
    }
  },
};

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

    if (!signature || !timestamp) return new Response(null, { status: 400 });

    const isVerified = nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, "hex"),
      Buffer.from(PUB_KEY, "hex")
    );

    if (!isVerified) return new Response("invalid request signature", { status: 401 });

    const data = JSON.parse(body);

    // PING
    if (data.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle commands
    if (data.type === 2) {
      const commandName = data.data?.name; // Discord sends the command name
      const handler = commandHandlers[commandName];

      if (handler) {
        return handler(data);
      }
    }

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

import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

// Initialize MySQL connection pool
export function initMySQLPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "mysql",
    user: process.env.MYSQL_USER || "translator",
    password: process.env.MYSQL_PASSWORD || "translator_password",
    database: process.env.MYSQL_DATABASE || "translator_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  console.log("✅ MySQL connection pool initialized");
  return pool;
}

// Get the pool instance
export function getPool() {
  if (!pool) {
    throw new Error("MySQL pool not initialized. Call initMySQLPool() first.");
  }
  return pool;
}

// Create tables if they don't exist
export async function initDatabase() {
  const db = getPool();

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS translation_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      original_message TEXT NOT NULL,
      original_message_hash VARCHAR(64) NOT NULL,
      target_language VARCHAR(50) NOT NULL,
      detected_language VARCHAR(50),
      translated_message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      use_count INT DEFAULT 1,
      INDEX idx_hash_lang (original_message_hash, target_language),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  try {
    await db.execute(createTableSQL);
    console.log("✅ Database tables initialized");
  } catch (error) {
    console.error("❌ Failed to initialize database tables:", error);
    throw error;
  }
}

// Hash function for messages (simple SHA-256 equivalent using Bun)
async function hashMessage(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export type TranslationHistoryEntry = {
  id: number;
  original_message: string;
  original_message_hash: string;
  target_language: string;
  detected_language: string | null;
  translated_message: string;
  created_at: Date;
  updated_at: Date;
  use_count: number;
};

// Check if translation exists in history
export async function getTranslationFromHistory(
  message: string,
  targetLanguage: string
): Promise<TranslationHistoryEntry | null> {
  const db = getPool();
  const messageHash = await hashMessage(message);

  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM translation_history 
     WHERE original_message_hash = ? 
     AND target_language = ? 
     ORDER BY use_count DESC, updated_at DESC 
     LIMIT 1`,
    [messageHash, targetLanguage.toLowerCase()]
  );

  if (rows.length === 0) {
    return null;
  }

  // Increment use count
  await db.execute(
    `UPDATE translation_history 
     SET use_count = use_count + 1, updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [rows[0].id]
  );

  return rows[0] as TranslationHistoryEntry;
}

// Save translation to history
export async function saveTranslationToHistory(
  originalMessage: string,
  targetLanguage: string,
  detectedLanguage: string,
  translatedMessage: string
): Promise<void> {
  const db = getPool();
  const messageHash = await hashMessage(originalMessage);

  // Check if this exact translation already exists
  const [existing] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM translation_history 
     WHERE original_message_hash = ? AND target_language = ?`,
    [messageHash, targetLanguage.toLowerCase()]
  );

  if (existing.length > 0) {
    // Update existing entry
    await db.execute(
      `UPDATE translation_history 
       SET translated_message = ?, 
           detected_language = ?, 
           use_count = use_count + 1,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [translatedMessage, detectedLanguage, existing[0].id]
    );
  } else {
    // Insert new entry
    await db.execute(
      `INSERT INTO translation_history 
       (original_message, original_message_hash, target_language, detected_language, translated_message) 
       VALUES (?, ?, ?, ?, ?)`,
      [originalMessage, messageHash, targetLanguage.toLowerCase(), detectedLanguage, translatedMessage]
    );
  }
}

// Get translation statistics
export async function getTranslationStats(): Promise<{
  total_translations: number;
  unique_messages: number;
  languages_used: number;
}> {
  const db = getPool();

  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT 
       COUNT(*) as total_translations,
       COUNT(DISTINCT original_message_hash) as unique_messages,
       COUNT(DISTINCT target_language) as languages_used
     FROM translation_history`
  );

  return rows[0] as any;
}

// Clean old translations (optional maintenance function)
export async function cleanOldTranslations(daysOld: number = 90): Promise<number> {
  const db = getPool();

  const [result] = await db.execute<mysql.ResultSetHeader>(
    `DELETE FROM translation_history 
     WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) 
     AND use_count = 1`,
    [daysOld]
  );

  return result.affectedRows;
}

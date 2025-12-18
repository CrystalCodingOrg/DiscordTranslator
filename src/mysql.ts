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

  const queries: string[] = []

  queries.push(`
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
  `);

  queries.push(`
    CREATE TABLE IF NOT EXISTS discord_user (
      id BIGINT PRIMARY KEY,
      username VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  queries.push(`
    CREATE TABLE IF NOT EXISTS history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      discord_id BIGINT NOT NULL,
      message_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (discord_id) REFERENCES discord_user(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES translation_history(id) ON DELETE CASCADE,
      INDEX idx_discord_id (discord_id),
      INDEX idx_message_id (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  try {
    for (const query of queries) {
      await db.execute(query);
    }
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

  const row = rows[0]!; // Safe because we checked length

  // Increment use count
  await db.execute(
    `UPDATE translation_history 
     SET use_count = use_count + 1, updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [row.id]
  );

  return row as TranslationHistoryEntry;
}

// Save or update Discord user
export async function saveDiscordUser(
  discordId: string,
  username: string
): Promise<void> {
  const db = getPool();

  await db.execute(
    `INSERT INTO discord_user (id, username) 
     VALUES (?, ?) 
     ON DUPLICATE KEY UPDATE username = ?, updated_at = CURRENT_TIMESTAMP`,
    [discordId, username, username]
  );
}

// Save translation to history
export async function saveTranslationToHistory(
  originalMessage: string,
  targetLanguage: string,
  detectedLanguage: string,
  translatedMessage: string,
  discordId?: string,
  username?: string
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
    const existingRow = existing[0]!; // Safe because we checked length
    // Update existing entry
    await db.execute(
      `UPDATE translation_history 
       SET translated_message = ?, 
           detected_language = ?, 
           use_count = use_count + 1,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [translatedMessage, detectedLanguage, existingRow.id]
    );
  } else {
    // Insert new entry
    const [result] = await db.execute<mysql.ResultSetHeader>(
      `INSERT INTO translation_history 
       (original_message, original_message_hash, target_language, detected_language, translated_message) 
       VALUES (?, ?, ?, ?, ?)`,
      [originalMessage, messageHash, targetLanguage.toLowerCase(), detectedLanguage, translatedMessage]
    );
    
    // Link to user if provided
    if (discordId && username) {
      await saveDiscordUser(discordId, username);
      await db.execute(
        `INSERT INTO history (discord_id, message_id) VALUES (?, ?)`,
        [discordId, result.insertId]
      );
    }
    return;
  }

  // If we updated an existing entry, still link to user if provided
  if (discordId && username && existing.length > 0) {
    const existingRow = existing[0]!;
    await saveDiscordUser(discordId, username);
    
    // Check if this user-message link already exists
    const [linkExists] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id FROM history WHERE discord_id = ? AND message_id = ?`,
      [discordId, existingRow.id]
    );
    
    if (linkExists.length === 0) {
      await db.execute(
        `INSERT INTO history (discord_id, message_id) VALUES (?, ?)`,
        [discordId, existingRow.id]
      );
    }
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

// Get user's translation history
export async function getUserTranslationHistory(
  discordId: string,
  limit: number = 50
): Promise<Array<TranslationHistoryEntry & { history_created_at: Date }>> {
  const db = getPool();

  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT th.*, h.created_at as history_created_at
     FROM history h
     JOIN translation_history th ON h.message_id = th.id
     WHERE h.discord_id = ?
     ORDER BY h.created_at DESC
     LIMIT ?`,
    [discordId, limit]
  );

  return rows as any;
}

// Delete all user data (for privacy/GDPR compliance)
export async function deleteUserData(discordId: string): Promise<{
  history_deleted: number;
  user_deleted: boolean;
}> {
  const db = getPool();

  // Delete history entries (will cascade delete from history table due to FK)
  const [historyResult] = await db.execute<mysql.ResultSetHeader>(
    `DELETE FROM history WHERE discord_id = ?`,
    [discordId]
  );

  // Delete user
  const [userResult] = await db.execute<mysql.ResultSetHeader>(
    `DELETE FROM discord_user WHERE id = ?`,
    [discordId]
  );

  return {
    history_deleted: historyResult.affectedRows,
    user_deleted: userResult.affectedRows > 0,
  };
}

// Get user statistics
export async function getUserStats(discordId: string): Promise<{
  total_translations: number;
  unique_messages: number;
  languages_used: number;
  oldest_translation: Date | null;
  newest_translation: Date | null;
}> {
  const db = getPool();

  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT 
       COUNT(*) as total_translations,
       COUNT(DISTINCT th.original_message_hash) as unique_messages,
       COUNT(DISTINCT th.target_language) as languages_used,
       MIN(h.created_at) as oldest_translation,
       MAX(h.created_at) as newest_translation
     FROM history h
     JOIN translation_history th ON h.message_id = th.id
     WHERE h.discord_id = ?`,
    [discordId]
  );

  return rows[0] as any;
}

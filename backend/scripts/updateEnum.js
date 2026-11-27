import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function addEnum() {
  try {
    await pool.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'system'");
    console.log("Successfully added 'system' to notification_type enum");
  } catch (err) {
    console.log("Enum update note:", err.message);
  }
  await pool.end();
}

addEnum().catch(console.error);

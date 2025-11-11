// db.js (ESM version)
import pkg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 🧠 Tự tạo bảng nếu chưa có
export async function initDatabase() {
  try {
    const client = await pool.connect();
    console.log("✅ PostgreSQL connected");

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(20) NOT NULL,
        region VARCHAR(10) NOT NULL,
        station VARCHAR(50) NOT NULL,
        label VARCHAR(100),
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createTableQuery);
    console.log("✅ Table 'tickets' ready");
    client.release();
  } catch (err) {
    console.error("❌ Database init error:", err.message);
  }
}

// Chạy init ngay khi module được import
initDatabase();

export default pool;

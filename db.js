// db.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Railway yêu cầu SSL
});

// 🧠 Hàm khởi tạo database (tạo bảng nếu chưa có)
async function initDatabase() {
  try {
    const client = await pool.connect();

    console.log("✅ PostgreSQL connected");

    // Tạo bảng tickets nếu chưa tồn tại
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

// Gọi hàm khởi tạo ngay khi khởi động
initDatabase();

module.exports = pool;

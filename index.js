// import express from "express";
// import fetch from "node-fetch";
// import cors from "cors";

// const app = express();
// app.use(cors());
// app.use(express.json());

// const TARGET_BASE = "https://xoso188.net";

// // ✅ Route proxy chính
// app.use("/api", async (req, res) => {
//   const targetUrl = TARGET_BASE + req.originalUrl; // giữ nguyên /api/...
//   console.log("→ Forwarding:", targetUrl);

//   try {
//     const response = await fetch(targetUrl, {
//       method: req.method,
//       headers: {
//         ...req.headers,
//         host: "xoso188.net"
//       },
//       body: ["GET", "HEAD"].includes(req.method) ? null : req.body
//     });

//     const body = await response.text();

//     res.status(response.status);
//     res.set("Access-Control-Allow-Origin", "*");
//     res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
//     res.set("Content-Type", response.headers.get("content-type") || "application/json");
//     res.send(body);
//   } catch (err) {
//     console.error("Proxy error:", err);
//     res.status(500).json({ error: "Proxy failed", message: err.message });
//   }
// });


// index.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// ========== 🧠 KẾT NỐI DATABASE & TẠO BẢNG ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDatabase() {
  try {
    await pool.connect();
    console.log("✅ PostgreSQL connected");

    // 🏗️ Tự động tạo bảng nếu chưa tồn tại
    const createTableSQL = `
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
    await pool.query(createTableSQL);
    console.log("✅ Table 'tickets' ready");
  } catch (err) {
    console.error("❌ Database init error:", err.message);
  }
}

// Gọi khởi tạo
initDatabase();

// ========== 🔥 KHỞI TẠO FIREBASE ADMIN ==========
try {
  let serviceAccount;
  if (process.env.FIREBASE_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  } else if (fs.existsSync("./serviceAccountKey.json")) {
    serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase Admin initialized");
  } else {
    console.log("⚠️ FIREBASE_KEY not found — Firebase Admin chưa khởi tạo!");
  }
} catch (e) {
  console.error("❌ Lỗi khi khởi tạo Firebase Admin:", e.message);
}

// ========== 🎟️ API NHẬN VÉ TỪ CLIENT ==========
app.post("/api/save-ticket", async (req, res) => {
  try {
    const { number, region, station, label, token } = req.body;
    if (!number || !region || !station || !token) {
      return res.status(400).json({ success: false, message: "Thiếu dữ liệu cần thiết" });
    }

    // 1️⃣ Lưu vé vào DB
    const result = await pool.query(
      `INSERT INTO tickets (ticket_number, region, station, label, token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [number, region, station, label, token]
    );

    console.log("🎟️ Vé mới được lưu:", { number, region, station, token });
    
    // 2️⃣ Gửi thông báo FCM đến thiết bị (sau 5 giây)
    if (admin.apps.length) {
      const message = {
        notification: {
          title: "🎫 Vé đã lưu thành công!",
          body: `Số ${number} - ${label} đã được lưu trên hệ thống.`,
        },
        token: token,
      };
    
      setTimeout(async () => {
        try {
          await admin.messaging().send(message);
          console.log("📤 (Delay 5s) FCM gửi thành công:", token.slice(0, 20) + "...");
        } catch (err) {
          console.warn("⚠️ (Delay 5s) Lỗi khi gửi FCM:", err.message);
        }
      }, 5000); // ⏱️ delay 5 giây
    }

    // 3️⃣ Trả về phản hồi client
    res.json({
      success: true,
      message: "Đã lưu vé và gửi thông báo thành công!",
      ticket: {
        id: result.rows[0].id,
        number,
        region,
        station,
        label,
        created_at: result.rows[0].created_at,
      },
    });

  } catch (err) {
    console.error("❌ Lỗi khi lưu vé:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 🌐 PROXY API ==========
const TARGET_BASE = "https://xoso188.net";
app.use("/api/xoso", async (req, res) => {
  const targetUrl = TARGET_BASE + req.originalUrl;
  console.log("→ Forwarding:", targetUrl);
  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { ...req.headers, host: "xoso188.net" },
      body: ["GET", "HEAD"].includes(req.method) ? null : req.body,
    });
    const body = await response.text();
    res.status(response.status);
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Content-Type", response.headers.get("content-type") || "application/json");
    res.send(body);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy failed", message: err.message });
  }
});

// ========== 🏠 ROOT ==========
app.get("/", (_, res) => res.send("✅ Railway Proxy + FCM + Ticket DB đang hoạt động!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy tại port " + PORT));


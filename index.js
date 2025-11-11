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
// So sánh số vé với kết quả từ API
function checkResult(ticketNumber, results) {
  const n = ticketNumber.trim();
  if (!results) return `⚠️ Không lấy được kết quả xổ số.`;

  // Giải Đặc Biệt
  if (results["ĐB"] && results["ĐB"].includes(n))
    return `🎉 Chúc mừng! Vé ${n} trúng 🎯 Giải Đặc Biệt!`;

  // Giải nhất
  if (results["G1"] && results["G1"].includes(n))
    return `🎉 Vé ${n} trúng 🏆 Giải Nhất!`;

  // Giải nhì
  if (results["G2"] && results["G2"].some(v => v.includes(n)))
    return `🎉 Vé ${n} trúng 🥈 Giải Nhì!`;

  // Giải ba
  if (results["G3"] && results["G3"].some(v => v.includes(n)))
    return `🎉 Vé ${n} trúng 🥉 Giải Ba!`;

  // Các giải còn lại (G4–G7)
  const lowerPrizes = ["G4", "G5", "G6", "G7", "G8"];
  for (let g of lowerPrizes) {
    const arr = Array.isArray(results[g]) ? results[g] : [results[g]];
    if (arr.some(v => v && v.includes(n))) {
      return `🎉 Vé ${n} trúng ${g}!`;
    }
  }

  // Không trúng
  return `😢 Vé ${n} không trúng thưởng.`;
}
//=============
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

    console.log("🎟️ Vé mới được lưu:", { number, region, station });

    // 2️⃣ Delay 5 giây rồi xử lý kết quả xổ số
    setTimeout(async () => {
      try {
        // Lấy dữ liệu kết quả Xổ Số từ API
        const apiUrl = `https://xoso188.net/api/${region}`;
        console.log("📡 Gọi API kết quả:", apiUrl);
        const response = await fetch(apiUrl);
        const data = await response.json();

        // ✅ Tùy định dạng API, ví dụ:
        // data.results = {
        //   "ĐB": "12345",
        //   "G1": "54321",
        //   "G2": ["11111", "22222"],
        //   ...
        // }

        const resultText = checkResult(number, data.results);

        // 3️⃣ Gửi FCM thông báo kết quả
        if (admin.apps.length) {
          const message = {
            notification: {
              title: "📢 Kết quả vé số của bạn",
              body: resultText,
            },
            token,
          };

          try {
            await admin.messaging().send(message);
            console.log("📤 Gửi thông báo kết quả:", resultText);
          } catch (err) {
            console.warn("⚠️ Gửi thông báo thất bại:", err.message);
          }
        }
      } catch (err) {
        console.error("❌ Lỗi khi kiểm tra kết quả:", err.message);
      }
    }, 5000);

    // Trả phản hồi cho client ngay lập tức
    res.json({
      success: true,
      message: "Đã lưu vé thành công! Hệ thống sẽ tự kiểm tra kết quả trong ít giây.",
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
app.use("/api", async (req, res) => {
  const targetUrl = TARGET_BASE + req.originalUrl; // giữ nguyên /api/...
  console.log("→ Forwarding:", targetUrl);

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: "xoso188.net"
      },
      body: ["GET", "HEAD"].includes(req.method) ? null : req.body
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




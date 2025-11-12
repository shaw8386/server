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

// ========== ⚙️ HÀM TIỆN ÍCH ==========
async function sendNotification(token, title, body) {
  if (!admin.apps.length) return;
  const message = { notification: { title, body }, token };
  try {
    await admin.messaging().send(message);
    console.log("📤 FCM gửi:", title, "-", body);
  } catch (err) {
    console.warn("⚠️ Gửi FCM lỗi:", err.message);
  }
}

// 🧠 So sánh kết quả vé
function checkResult(ticketNumber, results) {
  const n = ticketNumber.trim();
  if (!results) return `⚠️ Không lấy được kết quả xổ số.`;

  const match = (arr) => arr.some(v => v.endsWith(n)); // so sánh theo 5 số cuối

  if (results["ĐB"] && match(results["ĐB"])) return `🎯 Vé ${n} trúng Giải Đặc Biệt!`;
  if (results["G1"] && match(results["G1"])) return `🏆 Vé ${n} trúng Giải Nhất!`;
  if (results["G2"] && match(results["G2"])) return `🥈 Vé ${n} trúng Giải Nhì!`;
  if (results["G3"] && match(results["G3"])) return `🥉 Vé ${n} trúng Giải Ba!`;

  for (let g of ["G4", "G5", "G6", "G7", "G8"]) {
    if (results[g] && match(results[g])) return `🎉 Vé ${n} trúng ${g}!`;
  }

  return `😢 Vé ${n} không trúng thưởng.`;
}

// Chuyển savedAt (ví dụ "00:21:12 12/11/2025" hoặc "12/11/2025 00:21:12") -> "2025-11-12"
function normalizeSavedAt(savedAt) {
  if (!savedAt) return null;
  const dmy = savedAt.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = savedAt.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const dt = new Date(savedAt);
  return !isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
}

// Parse API xoso188.net
function parseLotteryApiResponse(data) {
  const out = { date: null, numbers: {} };
  if (!data) return out;

  try {
    const container = data.t || data;
    if (container && container.issueList && Array.isArray(container.issueList) && container.issueList.length > 0) {
      let issue = container.issueList.find(it => it.status === 2) || container.issueList[0];
      out.date = issue.openTime || issue.turnNum || container.turnNum || null;

      if (issue.detail) {
        let arr;
        try {
          arr = JSON.parse(issue.detail);
        } catch {
          arr = String(issue.detail).replace(/^\[|\]$/g, '').split(',').map(s => s.replace(/(^"|"$)/g, '').trim());
        }
        const prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];
        arr.forEach((val, idx) => {
          const nums = String(val).split(',').map(x => x.trim()).filter(Boolean);
          out.numbers[prizeNames[idx] || `G${idx}`] = nums;
        });
      }
    }
  } catch (err) {
    console.warn("⚠️ parseLotteryApiResponse lỗi:", err.message);
  }
  return out;
}

// ========== 🎟️ API NHẬN VÉ TỪ CLIENT ==========
app.post("/api/save-ticket", async (req, res) => {
  try {
    const { number, region, station, label, token, savedAt } = req.body;
    if (!number || !region || !station || !token)
      return res.status(400).json({ success: false, message: "Thiếu dữ liệu cần thiết" });

    // 1️⃣ Lưu vé vào DB
    const result = await pool.query(
      `INSERT INTO tickets (ticket_number, region, station, label, token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [number, region, station, label, token]
    );
    console.log("🎟️ Vé mới được lưu:", { number, region, station });

    res.json({
      success: true,
      message: "💾 Đã lưu vé! Hệ thống sẽ kiểm tra kết quả sau 5 giây.",
      ticket: {
        id: result.rows[0].id,
        number,
        region,
        station,
        label,
        created_at: result.rows[0].created_at,
      },
    });

    // 2️⃣ Sau 5s — kiểm tra kết quả ngay lập tức
    setTimeout(async () => {
      try {
        const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${encodeURIComponent(station)}`;
        console.log("📡 Gọi API kết quả:", apiUrl);

        const response = await fetch(apiUrl);
        const text = await response.text();

        let data;
        try {
          data = JSON.parse(text);
        } catch {
          console.warn("⚠️ Response not JSON:", text.slice(0, 300));
          data = null;
        }

        const parsed = parseLotteryApiResponse(data);
        console.log("📜 Parsed lottery result:", parsed);

        if (!parsed.numbers || Object.keys(parsed.numbers).length === 0) {
          await sendNotification(token, "📢 Kết quả vé số", "⚠️ Chưa có kết quả xổ số hôm nay.");
          return;
        }

        // Chuẩn hoá ngày để tránh lệch múi giờ
        const userYMD = normalizeSavedAt(savedAt);
        const resultYMD = normalizeSavedAt(parsed.date);
        console.log("📅 Ngày vé:", userYMD, "| Ngày kết quả:", resultYMD);

        const resultText = checkResult(number, parsed.numbers);
        await sendNotification(token, "🎟️ Kết quả vé số của bạn", resultText);

      } catch (err) {
        console.error("❌ Lỗi khi kiểm tra vé:", err);
        await sendNotification(token, "📢 Kết quả vé số", `⚠️ Lỗi khi kiểm tra kết quả: ${err.message || err}`);
      }
    }, 5000);

  } catch (err) {
    console.error("❌ Lỗi khi lưu vé:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 🌐 PROXY API ==========
const TARGET_BASE = "https://xoso188.net";
app.use("/api", async (req, res) => {
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
app.get("/", (_, res) =>
  res.send("✅ Railway Proxy + FCM + Ticket DB + Test Nhanh Auto Check hoạt động!")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy tại port " + PORT));

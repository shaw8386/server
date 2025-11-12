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

// ====================== 🧠 DATABASE ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDatabase() {
  try {
    await pool.connect();
    console.log("✅ PostgreSQL connected");

    // Tạo bảng nếu chưa có
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(20) NOT NULL,
        region VARCHAR(10) NOT NULL,
        station VARCHAR(50) NOT NULL,
        label VARCHAR(100),
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scheduled_time TIMESTAMP
      );
    `;
    await pool.query(createTableSQL);
    console.log("✅ Table 'tickets' ready");

    // Bổ sung cột scheduled_time nếu chưa tồn tại (migrations an toàn)
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='tickets' AND column_name='scheduled_time';
    `);
    if (colCheck.rows.length === 0) {
      await pool.query(`ALTER TABLE tickets ADD COLUMN scheduled_time TIMESTAMP;`);
      console.log("🆕 Added 'scheduled_time' column to tickets table");
    }
  } catch (err) {
    console.error("❌ Database init error:", err.message);
  }
}
initDatabase();

// ====================== 🔥 FIREBASE ADMIN ======================
try {
  let serviceAccount;
  if (process.env.FIREBASE_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  } else if (fs.existsSync("./serviceAccountKey.json")) {
    serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
  }

  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("✅ Firebase Admin initialized");
  } else {
    console.log("⚠️ FIREBASE_KEY not found — Firebase Admin chưa khởi tạo!");
  }
} catch (e) {
  console.error("❌ Firebase init error:", e.message);
}

// ====================== ⚙️ UTILS ======================
async function sendNotification(token, title, body) {
  if (!admin.apps.length) return;
  try {
    await admin.messaging().send({ notification: { title, body }, token });
    console.log("📤 FCM:", title, "-", body);
  } catch (err) {
    console.warn("⚠️ Gửi FCM lỗi:", err.message);
  }
}

// 🎯 Giờ xổ của từng miền
const DRAW_TIMES = {
  bac: { hour: 18, minute: 35 },
  trung: { hour: 17, minute: 35 },
  nam: { hour: 16, minute: 35 },
};

// ✅ Tính thời gian delay (ms) và thời điểm hẹn
function getSchedule(region) {
  const now = new Date();
  const draw = new Date(now);
  draw.setHours(DRAW_TIMES[region]?.hour || 18, DRAW_TIMES[region]?.minute || 35, 0, 0);
  const diff = draw - now;
  return { delay: diff > 0 ? diff : -1, scheduleTime: diff > 0 ? draw : new Date(Date.now() + 5000) };
}

// 🎯 Dò kết quả vé
function checkResult(ticketNumber, results) {
  const n = ticketNumber.trim().replace(/^0+/, "");
  if (!results) return "⚠️ Không lấy được kết quả xổ số.";

  const matchPrize = (arr, digits) => {
    const user = n.slice(-digits);
    return arr.some(v => String(v).slice(-digits) === user);
  };

  if (results["G8"] && matchPrize(results["G8"], 2))
    return `🎉 Vé ${ticketNumber} trúng Giải 8!`;
  if (results["G7"] && matchPrize(results["G7"], 3))
    return `🎉 Vé ${ticketNumber} trúng Giải 7!`;
  if (results["G6"] && matchPrize(results["G6"], 4))
    return `🎉 Vé ${ticketNumber} trúng Giải 6!`;
  if (results["G5"] && matchPrize(results["G5"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 5!`;
  if (results["G4"] && matchPrize(results["G4"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 4!`;
  if (results["G3"] && matchPrize(results["G3"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 3!`;
  if (results["G2"] && matchPrize(results["G2"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 2!`;
  if (results["G1"] && matchPrize(results["G1"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 1!`;
  if (results["ĐB"] && matchPrize(results["ĐB"], 6))
    return `🎯 Vé ${ticketNumber} trúng 🎖 Giải Đặc Biệt!`;

  return `😢 Vé ${ticketNumber} không trúng thưởng.`;
}

// 🎲 Parse dữ liệu kết quả từ API xoso188
function parseLotteryApiResponse(data) {
  const out = { date: null, numbers: {} };
  if (!data) return out;

  try {
    const container = data.t || data;
    if (container.issueList && container.issueList.length > 0) {
      const issue = container.issueList.find(it => it.status === 2) || container.issueList[0];
      out.date = issue.openTime || issue.turnNum;

      const prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];
      const detail = JSON.parse(issue.detail);
      detail.forEach((val, idx) => {
        const nums = String(val).split(",").map(x => x.trim()).filter(Boolean);
        out.numbers[prizeNames[idx]] = nums;
      });
    }
  } catch (err) {
    console.warn("⚠️ parseLotteryApiResponse lỗi:", err.message);
  }
  return out;
}

// ====================== 🎟️ SAVE TICKET ======================
app.post("/api/save-ticket", async (req, res) => {
  try {
    const { number, region, station, label, token } = req.body;
    if (!number || !region || !station || !token)
      return res.status(400).json({ success: false, message: "Thiếu dữ liệu" });

    const { delay, scheduleTime } = getSchedule(region);
    const isPast = delay < 0;

    // 1️⃣ Lưu vé vào DB (có scheduled_time)
    const result = await pool.query(
      `INSERT INTO tickets (ticket_number, region, station, label, token, scheduled_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at, scheduled_time`,
      [number, region, station, label, token, scheduleTime]
    );
    console.log("🎟️ Vé mới:", { number, region, station, scheduled_time: scheduleTime.toISOString() });

    // 2️⃣ Hẹn giờ check
    if (isPast) {
      console.log("🕓 Giờ xổ đã qua — check sau 5s");
      res.json({ success: true, message: "💾 Vé lưu thành công! Kết quả sẽ được kiểm tra ngay." });
      setTimeout(() => checkAndNotify({ number, station, token }), 5000);
    } else {
      const minutes = Math.round(delay / 60000);
      console.log(`⏳ Hẹn kiểm tra sau ${minutes} phút (${region.toUpperCase()})`);
      res.json({
        success: true,
        message: `💾 Vé lưu thành công! Sẽ kiểm tra sau ${minutes} phút.`,
        scheduled_time: scheduleTime.toLocaleString("vi-VN"),
      });
      setTimeout(() => checkAndNotify({ number, station, token }), delay);
    }
  } catch (err) {
    console.error("❌ Lỗi khi lưu vé:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ====================== 🎯 CHECK & NOTIFY ======================
async function checkAndNotify({ number, station, token }) {
  try {
    const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${encodeURIComponent(station)}`;
    console.log("📡 Gọi API kết quả:", apiUrl);

    const response = await fetch(apiUrl);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.warn("⚠️ Không parse được JSON, preview:", text.slice(0, 300));
      data = null;
    }

    const parsed = parseLotteryApiResponse(data);
    if (!parsed.numbers || Object.keys(parsed.numbers).length === 0) {
      await sendNotification(token, "📢 Kết quả vé số", "⚠️ Chưa có kết quả xổ số hôm nay.");
      return;
    }

    const resultText = checkResult(number, parsed.numbers);
    await sendNotification(token, "🎟️ Kết quả vé số của bạn", resultText);
  } catch (err) {
    console.error("❌ Lỗi check vé:", err.message);
    await sendNotification(token, "📢 Kết quả vé số", `⚠️ Lỗi khi kiểm tra: ${err.message}`);
  }
}

// ====================== 🌐 PROXY API ======================
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

// ====================== 🏠 ROOT ======================
app.get("/", (_, res) =>
  res.send("✅ Railway FCM + Ticket DB + Auto Schedule by Region + scheduled_time log hoạt động!")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy tại port " + PORT));

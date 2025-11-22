// ====================== IMPORTS ======================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";
import pkg from "pg";

process.env.TZ = "Asia/Ho_Chi_Minh";
const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

// ====================== 🧠 DATABASE ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("connect", client => {
  client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh';");
});

async function initDatabase() {
  try {
    await pool.connect();
    await pool.query(`SET TIME ZONE 'Asia/Ho_Chi_Minh';`);
    console.log("✅ PostgreSQL connected");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(20) NOT NULL,
        region VARCHAR(10) NOT NULL,
        station VARCHAR(50) NOT NULL,
        label VARCHAR(100),
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scheduled_time TIMESTAMP,
        processed BOOLEAN DEFAULT FALSE,
        buy_date VARCHAR(20)
      );
    `);

    console.log("✅ Table 'tickets' ready");
  } catch (err) {
    console.error("❌ Database init error:", err.message);
  }
}
initDatabase();

// ====================== 🔥 FIREBASE ======================
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
    console.log("⚠️ FIREBASE_KEY not found!");
  }
} catch (e) {
  console.error("❌ Firebase init error:", e.message);
}

// ====================== UTILS ======================
async function sendNotification(token, title, body) {
  if (!admin.apps.length) return;

  if (!token || token === "unknown" || token.length < 20) {
    console.log("⚠️ Bỏ qua gửi FCM — token không hợp lệ:", token);
    return;
  }

  try {
    await admin.messaging().send({ notification: { title, body }, token });
    console.log("📤 FCM:", title);
  } catch (err) {
    console.warn("⚠️ Gửi FCM lỗi:", err.message);
  }
}

// ====================== GIỜ XỔ ======================
const DRAW_TIMES = {
  bac: { hour: 18, minute: 35 },
  trung: { hour: 17, minute: 35 },
  nam: { hour: 16, minute: 35 },
};

// ====================== CHECK RESULT ======================
function checkResult(ticketNumber, results, region) {
  const n = ticketNumber.trim();
  const match = (arr, digits) => {
    const user = n.slice(-digits);
    return arr.some(v => String(v).trim().slice(-digits) === user);
  };

  if (!results) return "⚠️ Không lấy được kết quả xổ số.";

  if (region === "bac") {
    if (results["ĐB"] && match(results["ĐB"], 5)) return "🎯 Trúng Giải Đặc Biệt!";
    if (results["G1"] && match(results["G1"], 5)) return "🥇 Trúng Giải Nhất!";
    if (results["G2"] && match(results["G2"], 5)) return "🥈 Trúng Giải Nhì!";
    if (results["G3"] && match(results["G3"], 5)) return "🥉 Trúng Giải Ba!";
    if (results["G4"] && match(results["G4"], 4)) return "🎉 Trúng Giải 4!";
    if (results["G5"] && match(results["G5"], 4)) return "🎉 Trúng Giải 5!";
    if (results["G6"] && match(results["G6"], 3)) return "🎉 Trúng Giải 6!";
    if (results["G7"] && match(results["G7"], 2)) return "🎉 Trúng Giải 7!";
    return "❌ Không trúng thưởng.";
  }

  // MIỀN TRUNG/NAM
  if (results["ĐB"] && match(results["ĐB"], 6)) return "🎯 Trúng Giải Đặc Biệt!";
  if (results["G1"] && match(results["G1"], 5)) return "🥇 Trúng Giải Nhất!";
  if (results["G2"] && match(results["G2"], 5)) return "🥈 Trúng Giải Nhì!";
  if (results["G3"] && match(results["G3"], 5)) return "🥉 Trúng Giải Ba!";
  if (results["G4"] && match(results["G4"], 5)) return "🎉 Trúng Giải 4!";
  if (results["G5"] && match(results["G5"], 4)) return "🎉 Trúng Giải 5!";
  if (results["G6"] && match(results["G6"], 4)) return "🎉 Trúng Giải 6!";
  if (results["G7"] && match(results["G7"], 3)) return "🎉 Trúng Giải 7!";
  if (results["G8"] && match(results["G8"], 2)) return "🎉 Trúng Giải 8!";

  return "❌ Không trúng thưởng.";
}

// ====================== PARSE DATA ======================
function parseLotteryApiResponse(data, region, ticketDateStr) {
  const out = { date: null, numbers: {} };
  if (!data || !data.t || !data.t.issueList || data.t.issueList.length === 0) return out;

  try {
    let issue;

    if (ticketDateStr) {
      let target = ticketDateStr;
      if (ticketDateStr.includes("-")) {
        const [y, m, d] = ticketDateStr.split("-");
        target = `${d}/${m}/${y}`;
      }
      issue = data.t.issueList.find(i => i.turnNum === target);
    }

    if (!issue) {
      issue = data.t.issueList[0];
      console.warn("⚠ Không đúng ngày → fallback kỳ mới nhất");
    }

    out.date = issue.openTime;
    const detail = JSON.parse(issue.detail);

    const prizeNames =
      region === "bac"
        ? ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"]
        : ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];

    detail.forEach((raw, idx) => {
      const prize = prizeNames[idx];
      if (!prize) return;
      out.numbers[prize] = raw.split(",").map(v => v.trim());
    });

  } catch (err) {
    console.error("❌ parse FE error:", err);
  }

  return out;
}

// ====================== SAVE TICKET ======================
app.post("/api/save-ticket", async (req, res) => {
  try {
    const { number, region, station, label, token, buy_date } = req.body;

    if (!number || !region || !station || !token || !buy_date)
      return res.status(400).json({ success: false, message: "Thiếu dữ liệu" });

    const now = new Date();
    const buyDate = new Date(buy_date);

    if (!DRAW_TIMES[region])
      return res.status(400).json({ success: false, message: "region không hợp lệ" });

    // Tạo thời gian xổ theo ngày mua
    const drawTime = new Date(buyDate);
    drawTime.setHours(DRAW_TIMES[region].hour, DRAW_TIMES[region].minute, 0, 0);

    // ======================== DÒ NGAY ========================
    if (drawTime <= now) {
      console.log("🎯 Vé cũ hoặc đã tới giờ xổ → DÒ NGAY");

      const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=30&gameCode=${station}`;
      const resp = await fetch(apiUrl);
      const txt = await resp.text();
      let dataParsed;
      try { dataParsed = JSON.parse(txt); } catch { dataParsed = null; }

      const parsed = parseLotteryApiResponse(dataParsed, region, buy_date);
      const resultText = checkResult(number, parsed.numbers, region);

      sendNotification(token, "🎟️ Kết quả vé số", resultText);

      return res.json({
        success: true,
        mode: "immediate",
        result: resultText
      });
    }

    // ======================== ĐẶT LỊCH ========================
    const delay = drawTime - now;

    await pool.query(
      `INSERT INTO tickets (ticket_number, region, station, label, token, scheduled_time, buy_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [number, region, station, label, token, drawTime, buy_date]
    );

    console.log("⏳ Đặt lịch sau", delay / 1000, "giây");

    setTimeout(() => checkAndNotify({ number, station, token, region, buy_date }), delay);

    return res.json({
      success: true,
      mode: "scheduled",
      scheduled_time: drawTime.toLocaleString("vi-VN"),
      message: "Vé chưa xổ — đã đặt lịch"
    });

  } catch (err) {
    console.error("❌ save-ticket error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ====================== CHECK & NOTIFY ======================
async function checkAndNotify({ number, station, token, region, buy_date }) {
  try {
    const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=30&gameCode=${station}`;
    const resp = await fetch(apiUrl);
    const txt = await resp.text();
    let dataParsed;
    try { dataParsed = JSON.parse(txt); } catch { dataParsed = null; }

    const parsed = parseLotteryApiResponse(dataParsed, region, buy_date);
    const resultText = checkResult(number, parsed.numbers, region);

    sendNotification(token, "🎟️ Kết quả vé số", resultText);

  } catch (err) {
    console.error("❌ Lỗi check vé:", err.message);
  }
}

// ====================== JOB DỰ PHÒNG SAU RESTART ======================
setInterval(async () => {
  const now = new Date();
  const { rows } = await pool.query(
    `SELECT * FROM tickets 
     WHERE processed = FALSE AND scheduled_time <= $1`,
    [now]
  );

  for (const t of rows) {
    console.log("📌 Chạy lại vé bị quên sau restart >", t.id);
    await checkAndNotify({
      number: t.ticket_number,
      station: t.station,
      token: t.token,
      region: t.region,
      buy_date: t.buy_date,
    });

    await pool.query(`UPDATE tickets SET processed = TRUE WHERE id = $1`, [t.id]);
  }
}, 60 * 1000);

// ====================== PROXY ======================
const TARGET_BASE = "https://xoso188.net";
app.use("/api", async (req, res) => {
  const targetUrl = TARGET_BASE + req.originalUrl;
  console.log("→ Forwarding:", targetUrl);
  try {
    const response = await fetch(targetUrl);
    const body = await response.text();
    res.status(response.status).send(body);
  } catch (err) {
    res.status(500).json({ error: "Proxy failed", message: err.message });
  }
});

// ====================== ROOT ======================
app.get("/", (_, res) =>
  res.send("✅ Railway Lottery Server Running")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy port", PORT));

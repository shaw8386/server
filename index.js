// index.js
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

    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='tickets' AND column_name='scheduled_time';
    `);
    if (colCheck.rows.length === 0) {
      await pool.query(`ALTER TABLE tickets ADD COLUMN scheduled_time TIMESTAMP;`);
      console.log("🆕 Added 'scheduled_time' column");
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
    console.log("⚠️ FIREBASE_KEY not found!");
  }
} catch (e) {
  console.error("❌ Firebase init error:", e.message);
}

// ====================== ⚙️ UTILS ======================
async function sendNotification(token, title, body) {
  if (!admin.apps.length) return;

  // ❗ BỎ QUA TOKEN GIẢ / KHÔNG HỢP LỆ
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

// ====================== Giờ xổ ======================
const DRAW_TIMES = {
  bac: { hour: 18, minute: 35 },
  trung: { hour: 17, minute: 35 },
  nam: { hour: 16, minute: 35 },
};

// ====================== Check Result ======================
function checkResult(ticketNumber, results, region) {
  const n = ticketNumber.trim(); // giữ nguyên số, không xoá số 0 đầu

  const match = (arr, digits) => {
    const user = n.slice(-digits);
    return arr.some(v => String(v).trim().slice(-digits) === user);
  };

  if (!results) return "⚠️ Không lấy được kết quả xổ số.";

  // ============================
  // 🎯 Miền Bắc (5 số)
  // ============================
  if (region === "bac") {
    if (results["ĐB"] && match(results["ĐB"], 5))
      return "🎯 Trúng Giải Đặc Biệt!";

    if (results["G1"] && match(results["G1"], 5))
      return "🥇 Trúng Giải Nhất!";

    if (results["G2"] && match(results["G2"], 5))
      return "🥈 Trúng Giải Nhì!";

    if (results["G3"] && match(results["G3"], 5))
      return "🥉 Trúng Giải Ba!";

    if (results["G4"] && match(results["G4"], 5))
      return "🎉 Trúng Giải 4!";

    if (results["G5"] && match(results["G5"], 5))
      return "🎉 Trúng Giải 5!";

    if (results["G6"] && match(results["G6"], 3))
      return "🎉 Trúng Giải 6!";

    if (results["G7"] && match(results["G7"], 2))
      return "🎉 Trúng Giải 7!";

    return "❌ Không trúng thưởng.";
  }

  // ============================
  // 🎯 Miền Trung / Miền Nam (6 số)
  // ============================

  if (results["ĐB"] && match(results["ĐB"], 6))
    return "🎯 Trúng Giải Đặc Biệt!";

  if (results["G1"] && match(results["G1"], 5))
    return "🥇 Trúng Giải Nhất!";

  if (results["G2"] && match(results["G2"], 5))
    return "🥈 Trúng Giải Nhì!";

  if (results["G3"] && match(results["G3"], 5))
    return "🥉 Trúng Giải Ba!";

  if (results["G4"] && match(results["G4"], 5))
    return "🎉 Trúng Giải 4!";

  if (results["G5"] && match(results["G5"], 4))
    return "🎉 Trúng Giải 5!";

  if (results["G6"] && match(results["G6"], 4))
    return "🎉 Trúng Giải 6!";

  if (results["G7"] && match(results["G7"], 3))
    return "🎉 Trúng Giải 7!";

  if (results["G8"] && match(results["G8"], 2))
    return "🎉 Trúng Giải 8!";

  return "❌ Không trúng thưởng.";
}

function parseLotteryApiResponse(data, region) {
  const out = { date: null, numbers: {} };
  if (!data) return out;

  try {
    const container = data.t || data;
    const issue = container.issueList?.find(it => it.status === 2) || container.issueList?.[0];
    if (!issue) return out;

    out.date = issue.openTime || issue.turnNum;

    const detail = JSON.parse(issue.detail);

    if (region === "bac") {
      // MIỀN BẮC CHUẨN 27 GIẢI
      const prizeNames = ["ĐB","G1","G2","G3","G4","G5","G6","G7"];
      const counts = [1,1,1,6,4,6,3,4];

      let idx = 0;
      prizeNames.forEach((p, i) => {
        out.numbers[p] = detail.slice(idx, idx + counts[i]);
        idx += counts[i];
      });

    } else {
      // MIỀN TRUNG / NAM
      const prizeNames = ["ĐB","G1","G2","G3","G4","G5","G6","G7","G8"];
      const counts = [1,1,1,2,7,1,3,4,1];

      let idx = 0;
      prizeNames.forEach((p, i) => {
        out.numbers[p] = detail.slice(idx, idx + counts[i]);
        idx += counts[i];
      });
    }

    // Chuẩn hóa
    for (const k in out.numbers) {
      out.numbers[k] = out.numbers[k].map(x => String(x).trim());
    }

  } catch (err) {
    console.warn("⚠️ Parse error:", err.message);
  }
  return out;
}

// ====================== 🎟️ SAVE TICKET ======================
app.post("/api/save-ticket", async (req, res) => {
  try {
    const { number, region, station, label, token, buy_date } = req.body;

    if (!number || !region || !station || !token || !buy_date)
      return res.status(400).json({ success: false, message: "Thiếu dữ liệu" });

    const buyDate = new Date(buy_date);
    const today = new Date();

    const drawTime = new Date();
    drawTime.setHours(DRAW_TIMES[region].hour, DRAW_TIMES[region].minute, 0, 0);

    // ================================
    // 1️⃣ VÉ CŨ → DÒ NGAY
    // ================================
    if (buyDate < new Date(today.toDateString())) {
      console.log("🎯 Vé cũ → DÒ NGAY");

      const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${station}`;
      const resp = await fetch(apiUrl);
      const txt = await resp.text();

      let dataParsed;
      try { dataParsed = JSON.parse(txt); }
      catch { dataParsed = null; }

      const parsed = parseLotteryApiResponse(dataParsed, region);
      const resultText = checkResult(number, parsed.numbers, region);

      sendNotification(token, "🎟️ Kết quả vé số", resultText);

      return res.json({
        success: true,
        mode: "immediate",
        message: "Vé đã có kết quả — dò ngay",
        result: resultText
      });
    }

    // ================================
    // 2️⃣ VÉ HÔM NAY nhưng đã qua giờ xổ
    // ================================
    if (buyDate.toDateString() === today.toDateString() && today > drawTime) {
      console.log("🎯 Vé hôm nay đã qua giờ xổ → DÒ NGAY");

      const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${station}`;
      const resp = await fetch(apiUrl);
      const txt = await resp.text();

      let dataParsed;
      try { dataParsed = JSON.parse(txt); }
      catch { dataParsed = null; }

      const parsed = parseLotteryApiResponse(dataParsed, region);
      const resultText = checkResult(number, parsed.numbers, region);

      sendNotification(token, "🎟️ Kết quả vé số", resultText);

      return res.json({
        success: true,
        mode: "immediate",
        message: "Đã qua giờ xổ — dò ngay",
        result: resultText
      });
    }

    // ================================
    // 3️⃣ VÉ MỚI — LÊN LỊCH
    // ================================
    const delay = drawTime - today;

    await pool.query(
      `INSERT INTO tickets (ticket_number, region, station, label, token, scheduled_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [number, region, station, label, token, drawTime]
    );

    console.log("⏳ Đặt lịch sau", delay / 1000, "giây");

    setTimeout(() => checkAndNotify({ number, station, token, region }), delay);

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
async function checkAndNotify({ number, station, token, region }) {
  try {
    const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${station}`;
    console.log("📡 Gọi API:", apiUrl);

    const response = await fetch(apiUrl);
    const txt = await response.text();

    let dataParsed;
    try { dataParsed = JSON.parse(txt); }
    catch { dataParsed = null; }

    const parsed = parseLotteryApiResponse(dataParsed, region);

    const resultText = checkResult(number, parsed.numbers, region);

    sendNotification(token, "🎟️ Kết quả vé số", resultText);

  } catch (err) {
    console.error("❌ Lỗi check vé:", err.message);
  }
}

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





// ====================== IMPORTS ======================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";
import pkg from "pg";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import path from "path";
import { fileURLToPath } from "url";

process.env.TZ = "Asia/Ho_Chi_Minh";
const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

// ====================== SERVE FRONTEND (/public) ======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ====================== 🧠 DATABASE ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh';");
});

async function initDatabase() {
  try {
    await pool.connect();
    await pool.query("SET TIME ZONE 'Asia/Ho_Chi_Minh';");
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        full_name VARCHAR(120),
        photo_url TEXT,
        password_hash TEXT,
        points INT DEFAULT 0,
        last_claim_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
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
    console.log("⚠️ Bỏ qua gửi FCM — token không hợp lệ");
    return;
  }

  try {
    await admin.messaging().send({ notification: { title, body }, token });
    console.log("📤 FCM:", title);
  } catch (err) {
    console.warn("⚠️ Gửi FCM lỗi:", err.message);
  }
}

// ====================== AUTH HELPERS ======================
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function verifyTelegramAuth(payload) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { ok: false, message: "Missing TELEGRAM_BOT_TOKEN" };

  const { hash, ...data } = payload || {};
  if (!hash) return { ok: false, message: "Missing Telegram hash" };

  const keys = Object.keys(data).sort();
  const dataCheckString = keys
    .filter((k) => data[k] !== undefined && data[k] !== null)
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (hmac !== hash) return { ok: false, message: "Telegram signature invalid" };
  return { ok: true };
}

function signJwt(userRow) {
  const secret = requireEnv("JWT_SECRET");
  return jwt.sign({ uid: userRow.id, telegram_id: userRow.telegram_id }, secret, { expiresIn: "30d" });
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ success: false, message: "Missing token" });

  try {
    const secret = requireEnv("JWT_SECRET");
    req.auth = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

async function getUserSafeById(userId) {
  const { rows } = await pool.query(
    `SELECT telegram_id, full_name, photo_url, points,
            (last_claim_date = CURRENT_DATE) as claimed_today
     FROM users WHERE id=$1`,
    [userId]
  );
  return rows[0] || null;
}

// ====================== AUTH ROUTES ======================
// ====================== AUTH CALLBACK (DEEPLINK) ======================
app.get("/auth/callback", (req, res) => {
  const token = String(req.query.token || "");
  // ⚠️ đổi "gi8" theo scheme bạn muốn dùng trong app Unity
  const deeplink = `gi8://auth?token=${encodeURIComponent(token)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui;padding:16px;">
  <div>✅ Đăng nhập thành công. Đang quay lại ứng dụng...</div>
  <script>
    // redirect về app
    location.href = "${deeplink}";
  </script>
</body>
</html>
  `);
});

// ✅ LOGIN: username (telegram_id) + password
app.post("/auth/login", async (req, res) => {
  try {
    const { telegram_id, password } = req.body || {};
    const tgId = Number(telegram_id);

    if (!tgId || !password) {
      return res.status(400).json({ success: false, message: "Thiếu Username hoặc Password" });
    }

    const { rows } = await pool.query(`SELECT * FROM users WHERE telegram_id=$1`, [tgId]);
    if (!rows[0]) {
      return res.json({ success: false, code: "NOT_FOUND", message: "Chưa có tài khoản" });
    }

    const userRow = rows[0];

    if (!userRow.password_hash) {
      return res.json({
        success: false,
        code: "NO_PASSWORD",
        message: "Tài khoản chưa có mật khẩu, vui lòng đăng ký bằng Telegram",
      });
    }

    const ok = await bcrypt.compare(String(password), userRow.password_hash);
    if (!ok) {
      return res.json({ success: false, code: "WRONG_PASSWORD", message: "Sai mật khẩu" });
    }

    const token = signJwt(userRow);
    const safe = await getUserSafeById(userRow.id);
    return res.json({ success: true, token, user: safe });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ✅ REGISTER STEP 1: Telegram widget verify -> create user -> return reg_token
app.post("/auth/telegram-register", async (req, res) => {
  try {
    const tg = req.body || {};
    const vr = verifyTelegramAuth(tg);
    if (!vr.ok) return res.status(401).json({ success: false, message: vr.message });

    const telegram_id = Number(tg.id);
    if (!telegram_id) return res.status(400).json({ success: false, message: "Missing telegram id" });

    const full_name = `${tg.first_name || ""} ${tg.last_name || ""}`.trim();
    const photo_url = tg.photo_url || null;

    const { rows: found } = await pool.query(`SELECT * FROM users WHERE telegram_id=$1`, [telegram_id]);
    if (found[0]) {
      return res.json({
        success: false,
        code: "EXISTS",
        message: "Tài khoản đã tồn tại, hãy đăng nhập bằng Username + Password",
      });
    }

    await pool.query(
      `INSERT INTO users (telegram_id, full_name, photo_url) VALUES ($1, $2, $3)`,
      [telegram_id, full_name, photo_url]
    );

    const secret = requireEnv("JWT_SECRET");
    const reg_token = jwt.sign({ telegram_id, purpose: "register" }, secret, { expiresIn: "10m" });

    return res.json({
      success: true,
      code: "CREATED",
      telegram_id,
      full_name,
      reg_token,
      message: "Đăng ký Telegram OK, vui lòng đặt mật khẩu",
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ✅ REGISTER STEP 2: set password using reg_token -> login
app.post("/auth/register-set-password", async (req, res) => {
  try {
    const { reg_token, password } = req.body || {};
    if (!reg_token || !password) {
      return res.status(400).json({ success: false, message: "Thiếu reg_token hoặc password" });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ success: false, message: "Password tối thiểu 4 ký tự" });
    }

    const secret = requireEnv("JWT_SECRET");
    let payload;
    try {
      payload = jwt.verify(reg_token, secret);
    } catch {
      return res.status(401).json({ success: false, message: "reg_token hết hạn hoặc không hợp lệ" });
    }

    if (payload.purpose !== "register") {
      return res.status(401).json({ success: false, message: "reg_token không đúng mục đích" });
    }

    const telegram_id = Number(payload.telegram_id);
    const { rows } = await pool.query(`SELECT * FROM users WHERE telegram_id=$1`, [telegram_id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: "User không tồn tại" });

    const hash = await bcrypt.hash(String(password), 10);

    const { rows: updated } = await pool.query(
      `UPDATE users SET password_hash=$2 WHERE telegram_id=$1 RETURNING *`,
      [telegram_id, hash]
    );

    const token = signJwt(updated[0]);
    const safe = await getUserSafeById(updated[0].id);
    return res.json({ success: true, token, user: safe, message: "Đặt mật khẩu thành công" });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ✅ GET ME
app.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await getUserSafeById(req.auth.uid);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ====================== POINTS ROUTES ======================

// claim +1 điểm mỗi ngày
app.post("/app/points/claim-daily", authMiddleware, async (req, res) => {
  try {
    const { rows: exists } = await pool.query(`SELECT id FROM users WHERE id=$1`, [req.auth.uid]);
    if (!exists[0]) return res.status(404).json({ success: false, message: "User not found" });

    const { rows: check } = await pool.query(
      `SELECT (last_claim_date = CURRENT_DATE) as claimed_today
       FROM users WHERE id=$1`,
      [req.auth.uid]
    );

    if (check[0]?.claimed_today) {
      const user = await getUserSafeById(req.auth.uid);
      return res.json({ success: false, message: "Hôm nay bạn đã nhận điểm rồi!", user });
    }

    await pool.query(
      `UPDATE users
       SET points = points + 1,
           last_claim_date = CURRENT_DATE
       WHERE id=$1`,
      [req.auth.uid]
    );

    const user = await getUserSafeById(req.auth.uid);
    return res.json({ success: true, message: "Bạn đã nhận +1 điểm!", user });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

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
    return arr.some((v) => String(v).trim().slice(-digits) === user);
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
      issue = data.t.issueList.find((i) => i.turnNum === target);
    }

    if (!issue) issue = data.t.issueList[0];

    out.date = issue.openTime;
    const detail = JSON.parse(issue.detail);

    const prizeNames =
      region === "bac"
        ? ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"]
        : ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];

    detail.forEach((raw, idx) => {
      const prize = prizeNames[idx];
      if (prize) out.numbers[prize] = raw.split(",").map((v) => v.trim());
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

    let drawTime = new Date(buyDate);
    drawTime.setHours(DRAW_TIMES[region].hour, DRAW_TIMES[region].minute, 0, 0);

    const delay = drawTime - now;

    await pool.query(
      `INSERT INTO tickets (ticket_number, region, station, label, token, scheduled_time, buy_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [number, region, station, label, token, drawTime, buy_date]
    );

    console.log("⏳ Đặt lịch sau", delay / 1000, "giây");

    const safeDelay = delay > 0 ? delay : 1000;
    setTimeout(() => checkAndNotify({ number, station, token, region, buy_date }), safeDelay);

    res.json({
      success: true,
      mode: "scheduled",
      scheduled_time: drawTime.toLocaleString("vi-VN"),
      message: "Vé chưa xổ — đã đặt lịch",
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
    try {
      dataParsed = JSON.parse(txt);
    } catch {
      dataParsed = null;
    }

    const parsed = parseLotteryApiResponse(dataParsed, region, buy_date);
    const resultText = checkResult(number, parsed.numbers, region);

    sendNotification(token, "🎟️ Kết quả vé số", resultText);

    await pool.query(`UPDATE tickets SET processed = TRUE WHERE ticket_number=$1`, [number]);
  } catch (err) {
    console.error("❌ Lỗi check vé:", err.message);
  }
}

// ====================== JOB DỰ PHÒNG SAU RESTART ======================
setInterval(async () => {
  const now = new Date();
  const { rows } = await pool.query(
    `SELECT * FROM tickets WHERE processed = FALSE AND scheduled_time <= $1`,
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

// ====================== PROXY (giữ nguyên) ======================
const TARGET_BASE = "https://xoso188.net";
app.use("/api", async (req, res) => {
  const targetUrl = TARGET_BASE + req.originalUrl;
  try {
    const response = await fetch(targetUrl);
    const body = await response.text();
    res.status(response.status).send(body);
  } catch (err) {
    res.status(500).json({ error: "Proxy failed", message: err.message });
  }
});

// ====================== HEALTH ======================
app.get("/health", (_, res) => res.send("✅ Railway Lottery Server Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy port", PORT));




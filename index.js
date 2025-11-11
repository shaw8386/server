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

  if (results["ĐB"] && results["ĐB"].includes(n))
    return `🎉 Chúc mừng! Vé ${n} trúng 🎯 Giải Đặc Biệt!`;
  if (results["G1"] && results["G1"].includes(n))
    return `🎉 Vé ${n} trúng 🏆 Giải Nhất!`;
  if (results["G2"] && results["G2"].some(v => v.includes(n)))
    return `🎉 Vé ${n} trúng 🥈 Giải Nhì!`;
  if (results["G3"] && results["G3"].some(v => v.includes(n)))
    return `🎉 Vé ${n} trúng 🥉 Giải Ba!`;

  const lowerPrizes = ["G4", "G5", "G6", "G7", "G8"];
  for (let g of lowerPrizes) {
    const arr = Array.isArray(results[g]) ? results[g] : [results[g]];
    if (arr.some(v => v && v.includes(n))) {
      return `🎉 Vé ${n} trúng ${g}!`;
    }
  }

  return `😢 Vé ${n} không trúng thưởng.`;
}

// 🧩 Parse dữ liệu kết quả từ API xoso188.net (chuẩn hóa cho gameCode)
function parseLotteryApiResponse(data) {
  const out = { date: null, numbers: {} };
  if (!data) return out;

  try {
    // API mới của xoso188.net
    if (data.t && data.t.issueList && data.t.issueList.length > 0) {
      const issue = data.t.issueList[0];
      out.date = issue.turnNum || issue.openTime;

      // "detail" là chuỗi JSON chứa danh sách các giải
      if (issue.detail) {
        const prizes = JSON.parse(issue.detail);

        // ánh xạ các giải theo index
        const prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];
        prizes.forEach((val, idx) => {
          const key = prizeNames[idx] || `G${idx}`;
          const nums = String(val)
            .split(",")
            .map(x => x.trim())
            .filter(Boolean);
          out.numbers[key] = nums;
        });
      }
    }
  } catch (err) {
    console.warn("⚠️ parseLotteryApiResponse lỗi:", err.message);
  }

  console.log("🎯 Parsed lottery:", out);
  return out;
}


// ========== 🎟️ API NHẬN VÉ TỪ CLIENT ==========
app.post("/api/save-ticket", async (req, res) => {
  try {
    const { number, region, station, label, token, savedAt } = req.body;
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

    // 2️⃣ Sau 5s gọi API kết quả xổ số thật
    setTimeout(async () => {
      try {
        const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${encodeURIComponent(station)}`;
        console.log("📡 Gọi API kết quả:", apiUrl);

        const response = await fetch(apiUrl);
        const text = await response.text();

        let data;
        try {
          data = JSON.parse(text);
        } catch (err) {
          console.warn("⚠️ Không phải JSON, text=", text.slice(0, 200));
          data = {};
        }

        const parsed = parseLotteryApiResponse(data);
        console.log("📜 Parsed lottery result:", parsed);

        if (!parsed.numbers || Object.keys(parsed.numbers).length === 0) {
          await sendNotification(token, "📢 Kết quả vé số", `⚠️ Không lấy được kết quả xổ số.`);
          return;
        }

        // So sánh ngày (nếu có savedAt)
        if (savedAt && parsed.date) {
          const userDate = new Date(savedAt).toISOString().slice(0, 10);
          const resultDate = new Date(parsed.date).toISOString().slice(0, 10);
          if (userDate !== resultDate) {
            console.log("🕓 Kết quả chưa khớp ngày, bỏ qua check.");
            await sendNotification(token, "📢 Kết quả vé số", "⏳ Chưa có kết quả cho ngày hôm nay, vui lòng đợi.");
            return;
          }
        }

        const resultText = checkResult(number, parsed.numbers);
        await sendNotification(token, "📢 Kết quả vé số của bạn", resultText);
      } catch (err) {
        console.error("❌ Lỗi khi kiểm tra kết quả:", err.message);
        await sendNotification(token, "📢 Kết quả vé số", `⚠️ Lỗi khi kiểm tra kết quả: ${err.message}`);
      }
    }, 5000);

    res.json({
      success: true,
      message: "💾 Đã lưu vé! Hệ thống sẽ tự kiểm tra kết quả trong ít giây.",
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
app.get("/", (_, res) => res.send("✅ Railway Proxy + FCM + Ticket DB + Auto Check Lottery hoạt động!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy tại port " + PORT));



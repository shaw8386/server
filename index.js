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
  const n = ticketNumber.trim().replace(/^0+/, ""); // bỏ 0 đầu
  if (!results) return `⚠️ Không lấy được kết quả xổ số.`;

  // Hàm so khớp theo độ dài từng giải
  const matchPrize = (arr, digits) => {
    const user = n.slice(-digits);
    return arr.some(v => String(v).slice(-digits) === user);
  };

  // Giải 8 – 2 số cuối
  if (results["G8"] && matchPrize(results["G8"], 2))
    return `🎉 Vé ${ticketNumber} trúng Giải 8!`;

  // Giải 7 – 3 số cuối
  if (results["G7"] && matchPrize(results["G7"], 3))
    return `🎉 Vé ${ticketNumber} trúng Giải 7!`;

  // Giải 6 – 4 số cuối
  if (results["G6"] && matchPrize(results["G6"], 4))
    return `🎉 Vé ${ticketNumber} trúng Giải 6!`;

  // Giải 5 – 5 số cuối
  if (results["G5"] && matchPrize(results["G5"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 5!`;

  // Giải 4 – 5 số cuối
  if (results["G4"] && matchPrize(results["G4"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 4!`;

  // Giải 3 – 5 số cuối
  if (results["G3"] && matchPrize(results["G3"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 3!`;

  // Giải 2 – 5 số cuối
  if (results["G2"] && matchPrize(results["G2"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 2!`;

  // Giải 1 – 5 số cuối
  if (results["G1"] && matchPrize(results["G1"], 5))
    return `🎉 Vé ${ticketNumber} trúng Giải 1!`;

  // Đặc biệt – đủ 6 số
  if (results["ĐB"] && matchPrize(results["ĐB"], 6))
    return `🎯 Vé ${ticketNumber} trúng 🎖 Giải Đặc Biệt!`;

  return `😢 Vé ${ticketNumber} không trúng thưởng.`;
}

// ========== 📅 Format thời gian và parse API ==========
function normalizeSavedAt(savedAt) {
  if (!savedAt) return null;
  const dmy = savedAt.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const ymd = savedAt.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  const dt = new Date(savedAt);
  return !isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
}

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
          arr = String(issue.detail)
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(s => s.replace(/(^"|"$)/g, "").trim());
        }
        const prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];
        arr.forEach((val, idx) => {
          const nums = String(val)
            .split(",")
            .map(x => x.trim())
            .filter(Boolean);
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
      message: "💾 Đã lưu vé! Hệ thống sẽ kiểm tra kết quả sau 1 phút.",
      ticket: {
        id: result.rows[0].id,
        number,
        region,
        station,
        label,
        created_at: result.rows[0].created_at,
      },
    });

    // 2️⃣ Sau 1 phút (60 giây) → gọi API & gửi thông báo
    const delay = 60 * 1000; // 60s
    setTimeout(async () => {
      try {
        const apiUrl = `https://xoso188.net/api/front/open/lottery/history/list/game?limitNum=1&gameCode=${encodeURIComponent(station)}`;
        console.log(`📡 [AUTO CHECK] Gọi API kết quả: ${apiUrl}`);

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

        const resultText = checkResult(number, parsed.numbers);
        await sendNotification(token, "🎟️ Kết quả vé số của bạn", resultText);
      } catch (err) {
        console.error("❌ Lỗi khi kiểm tra vé:", err);
        await sendNotification(token, "📢 Kết quả vé số", `⚠️ Lỗi khi kiểm tra kết quả: ${err.message || err}`);
      }
    }, delay);
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
  res.send("✅ Railway Proxy + FCM + Ticket DB + Auto Check after 1 minute hoạt động!")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy tại port", PORT));


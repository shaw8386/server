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

// Chuyển savedAt (ví dụ "00:21:12 12/11/2025" hoặc "12/11/2025 00:21:12") -> "2025-11-12"
function normalizeSavedAt(savedAt) {
  if (!savedAt) return null;
  // tìm ngày dạng DD/MM/YYYY hoặc YYYY-MM-DD trong chuỗi
  // hỗ trợ nhiều format
  const dmy = savedAt.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); // 12/11/2025
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const mon = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return `${year}-${mon}-${day}`; // yyyy-mm-dd
  }
  const ymd = savedAt.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const year = ymd[1];
    const mon = ymd[2].padStart(2,'0');
    const day = ymd[3].padStart(2,'0');
    return `${year}-${mon}-${day}`;
  }
  // fallback: try Date parse then toISOString
  const dt = new Date(savedAt);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
  return null;
}

// Mới: parse API response theo định dạng bạn đã paste
function parseLotteryApiResponse(data) {
  const out = { date: null, numbers: {} };
  if (!data) return out;

  try {
    // trường hợp API trả object chứa 't' (theo log bạn gửi)
    // data.t.issueList is array of issues (mỗi issue.detail là string JSON array)
    const container = data.t || data; // support both
    if (container && container.issueList && Array.isArray(container.issueList) && container.issueList.length > 0) {
      // ưu tiên chọn issue có status === 2 (đã mở) hoặc turnNum gần nhất
      let issue = container.issueList.find(it => it.status === 2) || container.issueList[0];

      // sometimes API returns issueList sorted newest first - using first is OK
      if (!issue && container.issueList.length > 0) issue = container.issueList[0];

      // date: prefer openTime or turnNum
      out.date = issue.openTime || issue.turnNum || container.turnNum || null;

      // detail là string JSON: '["77776","60572","41844,64011", ...]'
      if (issue.detail) {
        let arr;
        try {
          arr = JSON.parse(issue.detail);
        } catch (e) {
          // nếu không parse được, cố gắng extract bằng regex
          const txt = String(issue.detail);
          arr = txt.replace(/^\[|\]$/g, '').split(',').map(s => s.replace(/(^"|"$)/g,'').trim());
        }
        // prizeNames index mapping
        const prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];
        arr.forEach((val, idx) => {
          const key = prizeNames[idx] || `G${idx}`;
          // val có thể chứa nhiều số cách nhau bằng comma -> split
          const nums = String(val)
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);
          out.numbers[key] = nums;
        });
      }
      return out;
    }

    // fallback: nếu response có data[] kiểu khác (kept from previous code)
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const item = data.data[0];
      out.date = item.openDate || item.day || item.createDate || out.date;
      if (item.prize && Array.isArray(item.prize)) {
        for (const p of item.prize) {
          const key = (p.prizeName || "").trim().toUpperCase();
          const nums = (p.numberList || "")
            .split(/[,\s]+/)
            .map(x => x.trim())
            .filter(Boolean);
          if (key && nums.length) out.numbers[key] = nums;
        }
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
          console.warn("⚠️ Response not JSON, raw text preview:", text.slice(0,300));
          data = null;
        }
    
        // nếu có data dạng 'success... t ...' như log, parseLotteryApiResponse sẽ xử lý
        const parsed = parseLotteryApiResponse(data || (function(){ try{ return JSON.parse(text);}catch(e){return null;} })());
        console.log("📜 Parsed lottery result:", parsed);
    
        // nếu không có numbers -> debug thêm raw text và trả thông báo "chưa có kết quả"
        if (!parsed.numbers || Object.keys(parsed.numbers).length === 0) {
          console.warn("⚠️ Parsed numbers empty, raw response preview:", text.slice(0,800));
          await sendNotification(token, "📢 Kết quả vé số", `⚠️ Không lấy được kết quả xổ số (server chưa cung cấp).`);
          return;
        }
    
        // chuẩn hoá savedAt của user sang yyyy-mm-dd để so sánh
        const userYMD = normalizeSavedAt(savedAt); // trả null nếu không parse được
        let resultYMD = null;
        if (parsed.date) {
          // parsed.date có thể là "11/11/2025" hoặc "2025-11-11 18:15:00" -> chuẩn hoá
          const dmatch1 = String(parsed.date).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
          const dmatch2 = String(parsed.date).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
          if (dmatch1) resultYMD = `${dmatch1[3]}-${dmatch1[2].padStart(2,'0')}-${dmatch1[1].padStart(2,'0')}`;
          else if (dmatch2) resultYMD = `${dmatch2[1]}-${dmatch2[2].padStart(2,'0')}-${dmatch2[3].padStart(2,'0')}`;
          else {
            const dt = new Date(parsed.date);
            if (!isNaN(dt.getTime())) resultYMD = dt.toISOString().slice(0,10);
          }
        }
    
        // Nếu user gửi savedAt và resultYMD tồn tại, so sánh; nếu khác thì báo người dùng chờ
        if (userYMD && resultYMD && userYMD !== resultYMD) {
          console.log("🕓 Ngày user và ngày kết quả khác:", userYMD, resultYMD);
          await sendNotification(token, "📢 Kết quả vé số", `⏳ Kết quả hiện tại là ${resultYMD}, vé bạn lưu ngày ${userYMD}. Vui lòng đợi kết quả đúng ngày.`);
          return;
        }
    
        // cuối cùng so sánh số
        const resultText = checkResult(number, parsed.numbers);
        await sendNotification(token, "📢 Kết quả vé số của bạn", resultText);
    
      } catch (err) {
        console.error("❌ Lỗi khi kiểm tra kết quả:", err);
        await sendNotification(token, "📢 Kết quả vé số", `⚠️ Lỗi khi kiểm tra kết quả: ${err.message || err}`);
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




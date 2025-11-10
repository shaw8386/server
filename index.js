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


import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import cron from "node-cron";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

// ========== 🔥 KHỞI TẠO FIREBASE ADMIN ==========
let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin initialized");
} catch (e) {
  console.log("⚠️ Không tìm thấy serviceAccountKey.json — bỏ qua FCM init");
}

// ========== 🔔 TOKEN THIẾT BỊ TEST ==========
const TEST_TOKEN = "dán_token_của_bạn_vào_đây";

// ========== 🧪 ROUTE GỬI THÔNG BÁO THỦ CÔNG ==========
app.get("/send-fcm", async (req, res) => {
  if (!admin.apps.length) return res.json({ error: "FCM chưa khởi tạo" });

  const message = {
    notification: {
      title: "👋 Hello từ server!",
      body: "Test thủ công tại " + new Date().toLocaleTimeString(),
    },
    token: TEST_TOKEN,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("✅ FCM gửi thành công:", response);
    res.json({ success: true, response });
  } catch (err) {
    console.error("❌ Lỗi FCM:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== ⏰ GỬI TỰ ĐỘNG MỖI 5 GIÂY ==========
cron.schedule("*/5 * * * * *", async () => {
  if (!admin.apps.length) return;
  const message = {
    notification: {
      title: "🔥 Server tự động gửi",
      body: "Hello lúc " + new Date().toLocaleTimeString(),
    },
    token: TEST_TOKEN,
  };

  try {
    await admin.messaging().send(message);
    console.log("📤 Auto gửi FCM thành công:", new Date().toLocaleTimeString());
  } catch (err) {
    console.error("⚠️ Auto gửi lỗi:", err.message);
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
      headers: {
        ...req.headers,
        host: "xoso188.net",
      },
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
app.get("/", (_, res) => res.send("✅ Railway Proxy + FCM Server đang hoạt động!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server chạy tại port " + PORT));

// app.get("/", (_, res) => res.send("✅ Railway Proxy đang hoạt động!"));

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log("🚀 Proxy server chạy tại port " + PORT));


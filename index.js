import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const TARGET_BASE = "https://xoso188.net";

// ✅ Route proxy chính
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

app.get("/", (_, res) => res.send("✅ Railway Proxy đang hoạt động!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Proxy server chạy tại port " + PORT));

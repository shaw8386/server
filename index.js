import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors()); // bật CORS cho frontend
app.use(express.json());

const TARGET_BASE = "https://xoso188.net"; // API gốc

// --- Route proxy chính ---
app.use("/api/*", async (req, res) => {
  const path = req.originalUrl.replace("/api", ""); // /api/front/... -> /front/...
  const targetUrl = TARGET_BASE + path + (req.url.includes("?") ? "" : "");

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { ...req.headers, host: "xoso188.net" },
      body: ["GET", "HEAD"].includes(req.method) ? null : req.body
    });
    const body = await response.text();

    // copy lại status và headers
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

// --- Route kiểm tra hoạt động ---
app.get("/", (req, res) => {
  res.send("✅ Railway Proxy is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Proxy server running on port " + PORT));

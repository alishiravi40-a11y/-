import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3001;

app.use(express.json({ limit: "50mb" }));

// Persistent storage files
const STORE_FILE = path.join(process.cwd(), "central_app_state.json");
const CONFIG_FILE = path.join(process.cwd(), "supabase_config.json");

let memoryState: any = null;
let lastVersion = Date.now();
let lastUpdatedBy = "";

// Load initial state from disk
try {
  if (fs.existsSync(STORE_FILE)) {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    memoryState = JSON.parse(raw);
    console.log("Loaded central app state from central_app_state.json");
  }
} catch (e) {
  console.error("Failed to read central_app_state.json:", e);
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: "fullstack_central" });
});

app.get("/api/app-state", (req, res) => {
  res.json({
    version: lastVersion,
    updatedBy: lastUpdatedBy,
    data: memoryState
  });
});

app.post("/api/app-state", (req, res) => {
  try {
    const { state, deviceId } = req.body;
    if (state) {
      memoryState = state;
      lastVersion = Date.now();
      lastUpdatedBy = deviceId || "unknown";
      fs.writeFileSync(STORE_FILE, JSON.stringify(memoryState), "utf-8");
      return res.json({ success: true, version: lastVersion });
    }
    res.status(400).json({ error: "No state provided" });
  } catch (err: any) {
    console.error("Error saving central state:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/supabase-config", (req, res) => {
  try {
    let config = { 
      url: process.env.VITE_SUPABASE_URL || "", 
      key: process.env.VITE_SUPABASE_ANON_KEY || "" 
    };
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      if (saved.url && saved.key) {
        config = saved;
      }
    }
    res.json(config);
  } catch (e) {
    res.json({ url: "", key: "" });
  }
});

app.post("/api/supabase-config", (req, res) => {
  try {
    const { url, key } = req.body;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url, key }), "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

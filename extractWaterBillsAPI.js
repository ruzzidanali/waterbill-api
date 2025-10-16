import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { processPDF } from "./extractWaterBillsEngine.js";

dotenv.config(); // Load environment variables from .env

// 🌍 Environment variables (with defaults)
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
const TEMPLATE_DIR = process.env.TEMPLATE_DIR || "templates";
const DEBUG_DIR = process.env.DEBUG_DIR || "debug_text";

// 🧱 Ensure required folders exist (auto-create on startup)
for (const dir of [UPLOAD_DIR, DEBUG_DIR, path.join(DEBUG_DIR, "crops")]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created missing folder: ${dir}`);
  }
}

const app = express();
app.use(cors());

// ✅ Keep uploaded file’s original name
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    cb(null, file.originalname); // Keep original filename
  }
});
const upload = multer({ storage });

// 🌐 Health check
app.get("/", (req, res) => res.send("✅ Water Bill Extractor API running."));
app.get("/health", (req, res) => res.json({ ok: true, status: "running" }));

// 🧾 Upload & extract endpoint
app.post("/extract", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded." });

  const filePath = path.resolve(file.path);
  const originalName = file.originalname;

  try {
    console.log(`📄 Received file: ${originalName}`);
    const result = await processPDF(filePath);

    // ✅ Force File_Name to use uploaded filename
    result.File_Name = originalName;

    res.json(result);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    // 🧹 Optional: remove uploaded file after processing
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
});

// 🚀 Start API
app.listen(PORT, () => console.log(`🚀 API running at http://localhost:${PORT}`));

import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { processPDF } from "./extractWaterBillsEngine.js";

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(cors());

app.post("/extract", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded." });
  const filePath = path.resolve(file.path);

  try {
    console.log(`📄 Received file: ${file.originalname}`);
    const result = await processPDF(filePath);
    result.File_Name = file.originalname;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlinkSync(filePath);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 API running at http://localhost:${PORT}`)
);

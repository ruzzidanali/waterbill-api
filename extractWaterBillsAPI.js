import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { processPDF } from "./extractWaterBillsEngine.js";

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(cors());

// app.post("/extract", upload.single("file"), async (req, res) => {
//   const file = req.file;
//   if (!file) return res.status(400).json({ error: "No file uploaded." });
//   const filePath = path.resolve(file.path);

//   try {
//     console.log(`📄 Received file: ${file.originalname}`);
//     const result = await processPDF(filePath);
//     result.File_Name = file.originalname;
//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   } finally {
//     fs.unlinkSync(filePath);
//   }
// });

app.post("/extract-multiple", upload.array("files"), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0)
    return res.status(400).json({ error: "No files uploaded." });

  console.log(`📦 Received ${files.length} files`);

  const results = [];

  for (const file of files) {
    const filePath = path.resolve(file.path);
    const originalName = file.originalname;
    console.log(`🧾 Processing: ${originalName}`);

    try {
      const result = await processPDF(filePath);
      result.File_Name = originalName;
      results.push(result);
    } catch (err) {
      console.error(`❌ Error processing ${originalName}:`, err.message);
      results.push({
        File_Name: originalName,
        ok: false,
        error: err.message,
      });
    } finally {
      fs.unlinkSync(filePath);
    }
  }

  res.json({
    ok: true,
    total: results.length,
    results,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 API running at http://localhost:${PORT}`)
);

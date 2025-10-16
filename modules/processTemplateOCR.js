import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import dotenv from "dotenv";
import {
  parseJohorFields,
  parseKedahFields,
  parseNegeriSembilanFields,
  standardizeOutput
} from "./regionParsers.js";

dotenv.config();

// 🧩 Environment-aware directories
const DEBUG_DIR = process.env.DEBUG_DIR || "debug_text";
const __dirname = path.resolve();

// 🧱 Ensure debug folders exist
const debugDir = path.join(__dirname, DEBUG_DIR);
const cropsDir = path.join(debugDir, "crops");
for (const d of [debugDir, cropsDir]) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    console.log(`📁 Created folder: ${d}`);
  }
}

// 🧮 Design reference
const designWidth = 2481;
const designHeight = 3509;

/* --------------------------------------------------
   📚 Helpers
-------------------------------------------------- */
function cleanNumeric(v) {
  if (!v) return "";
  return v
    .replace(/rm\s*/gi, "")
    .replace(/[^\d.,]/g, "")
    .replace(/,+/g, "")
    .trim();
}

function cleanAddress(text) {
  if (!text) return "";
  let lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const stopWords = ["selangor", "kuala lumpur", "putrajaya", "labuan"];
  const lowerLines = lines.map(l => l.toLowerCase());
  const idx = lowerLines.findLastIndex(l =>
    stopWords.some(c => l.includes(c))
  );
  if (idx !== -1) lines = lines.slice(0, idx + 1);
  return lines.join("\n");
}

function countAddressLines(t) {
  if (!t) return 6;
  const lines = t.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
  return lines.length;
}

/* --------------------------------------------------
   ✂️ processTemplateOCR()
-------------------------------------------------- */
export async function processTemplateOCR(imagePath, template, fileName, region) {
  const meta = await sharp(imagePath).metadata();
  const scaleX = meta.width / designWidth;
  const scaleY = meta.height / designHeight;
  const worker = await createWorker("eng");
  const results = {};

  // 📬 Address OCR first
  let addressText = "";
  if (template["Address"]) {
    const b = template["Address"];
    const s = {
      left: Math.round(b.x * scaleX),
      top: Math.round(b.y * scaleY),
      width: Math.round(b.w * scaleX),
      height: Math.round(b.h * scaleY)
    };
    const addrCrop = path.join(cropsDir, "Address.png");
    await sharp(imagePath).extract(s).toFile(addrCrop);
    const r = await worker.recognize(addrCrop);
    addressText = cleanAddress(r.data.text.trim());
    results["Address"] = addressText;
  }

  // 📏 Offset correction
  const addressLines = countAddressLines(addressText);
  const offsetY = -(6 - addressLines) * 50;

  const moveKeys = [
    "No. Meter",
    "Bilangan Hari - Start",
    "Bilangan Hari - End",
    "Baki Terdahulu",
    "Bil Semasa",
    "Jumlah Perlu Dibayar",
    "Penggunaan (m3)"
  ];

  // 🔲 OCR each defined box
  for (const [key, box] of Object.entries(template)) {
    if (key === "Address") continue;
    const applyOffset = moveKeys.includes(key) ? offsetY : 0;
    const s = {
      left: Math.round(box.x * scaleX),
      top: Math.round((box.y + applyOffset) * scaleY),
      width: Math.round(box.w * scaleX),
      height: Math.round(box.h * scaleY)
    };
    const crop = path.join(cropsDir, `${key.replace(/\s+/g, "_")}.png`);
    try {
      await sharp(imagePath).extract(s).toFile(crop);
      const r = await worker.recognize(crop);
      let text = r.data.text.trim();
      console.log(`📄 OCR ${key}:`, `"${text}"`);
      if (
        ["Bil Semasa", "Jumlah Perlu Dibayar", "Baki Terdahulu", "Cagaran", "Penggunaan (m3)"].includes(
          key
        )
      )
        text = cleanNumeric(text);
      results[key] = text;
    } catch {
      results[key] = "";
    }
  }

  await worker.terminate();

  // 🧮 Compute date range & days
  const norm = d => {
    if (!d) return null;
    const cleaned = d
      .trim()
      .replace(/[^\d/.\-]/g, "")
      .replace(/[.]/g, "/")
      .replace(/\s+/g, "");
    const m = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return null;
    const [, dd, mm, yy] = m;
    const yyyy = yy.length === 2 ? "20" + yy : yy;
    return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
  };

  const start =
    norm(results["Bilangan Hari - Start"]) ||
    norm(results["Bilangan_Hari_-_Start"]) ||
    norm(results["Bilangan_Hari - Start"]);
  const end =
    norm(results["Bilangan Hari - End"]) ||
    norm(results["Bilangan_Hari_-_End"]) ||
    norm(results["Bilangan_Hari - End"]);

  let bilDays = "";
  let tempohBil = "";

  if (start && end) {
    const d1 = new Date(start.split("/").reverse().join("-"));
    const d2 = new Date(end.split("/").reverse().join("-"));
    bilDays = Math.abs(Math.round((d2 - d1) / 86400000)).toString();
    tempohBil = `${start} - ${end}`;
    console.log(`✅ Computed Tempoh Bil: ${tempohBil} (${bilDays} days)`);
  } else {
    console.warn("⚠️ Missing start/end date:", { start, end });
  }

  delete results["Bilangan Hari - Start"];
  delete results["Bilangan Hari - End"];

  let final = {
    "File Name": fileName,
    Region: region,
    "Address Lines Count": addressLines,
    ...results,
    ...(tempohBil ? { "Tempoh Bil": tempohBil } : {}),
    ...(bilDays ? { "Bilangan Hari": bilDays } : {})
  };

  // 🧮 Region-specific parsing
  const reg = region.toLowerCase();
  if (reg.includes("johor")) {
    final = parseJohorFields(results);
    final.Region = "Johor";
  } else if (reg.includes("kedah")) {
    final = parseKedahFields(results, fileName);
    if (tempohBil) final["Tempoh Bil"] = tempohBil;
    if (bilDays) final["Bilangan Hari"] = bilDays;
  } else if (reg.includes("negeri")) {
    final = {
      ...parseNegeriSembilanFields(results),
      "File Name": fileName,
      Region: "Negeri-Sembilan"
    };
  }

  // 🧾 Standardize
  const standardized = standardizeOutput(final);
  return standardized;
}

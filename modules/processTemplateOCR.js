// modules/processTemplateOCR.js
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import {
  parseJohorFields,
  parseKedahFields,
  parseNegeriSembilanFields,
  standardizeOutput
} from "./regionParsers.js";

const debugDir = path.join(process.cwd(), "debug_text");
const cropsDir = path.join(debugDir, "crops");
if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
if (!fs.existsSync(cropsDir)) fs.mkdirSync(cropsDir, { recursive: true });

// 📏 Reference PDF design size
const designWidth = 2481;
const designHeight = 3509;

/* --------------------------------------------------
   📚 Utility Functions
-------------------------------------------------- */
const cleanNumeric = v =>
  !v
    ? "0.00"
    : v
        .replace(/rm\s*/gi, "")
        .replace(/[^\d.,-]/g, "")
        .replace(",", ".")
        .trim();

const cleanAddress = t => {
  if (!t) return "";
  let lines = t.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const stopWords = ["selangor", "kuala lumpur", "putrajaya", "labuan"];
  const idx = lines.findLastIndex(l =>
    stopWords.some(c => l.toLowerCase().includes(c))
  );
  if (idx !== -1) lines = lines.slice(0, idx + 1);
  return lines.join("\n");
};

const countAddressLines = t =>
  !t
    ? 6
    : t.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0).length;

const normalizeDate = d => {
  if (!d) return null;
  const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const yyyy = yy.length === 2 ? "20" + yy : yy;
  return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
};

/* --------------------------------------------------
   ✂️ processTemplateOCR()
-------------------------------------------------- */
export async function processTemplateOCR(imagePath, template, fileName, region) {
  console.log(`🧩 OCR process start for ${region}`);
  const meta = await sharp(imagePath).metadata();
  const scaleX = meta.width / designWidth;
  const scaleY = meta.height / designHeight;
  const results = {};

  // 🧠 Create shared OCR worker
  const worker = await createWorker("eng");

  // 📬 Address first
  let addressText = "";
  if (template["Address"]) {
    const b = template["Address"];
    const cropRect = {
      left: Math.round(b.x * scaleX),
      top: Math.round(b.y * scaleY),
      width: Math.round(b.w * scaleX),
      height: Math.round(b.h * scaleY)
    };
    const addrCrop = path.join(cropsDir, "Address.png");
    await sharp(imagePath).extract(cropRect).toFile(addrCrop);
    const r = await worker.recognize(addrCrop);
    addressText = cleanAddress(r.data.text.trim());
    results["Address"] = addressText;
  }

  const offsetY = -(6 - countAddressLines(addressText)) * 50;

  const moveKeys = [
    "No. Meter",
    "Bilangan Hari - Start",
    "Bilangan Hari - End",
    "Baki Terdahulu",
    "Bil Semasa",
    "Jumlah Perlu Dibayar",
    "Penggunaan (m3)"
  ];

  // 🔲 Parallel OCR for all fields
  const fieldEntries = Object.entries(template).filter(([k]) => k !== "Address");

  await Promise.all(
    fieldEntries.map(async ([key, box]) => {
      try {
        const applyOffset = moveKeys.includes(key) ? offsetY : 0;
        const rect = {
          left: Math.round(box.x * scaleX),
          top: Math.round((box.y + applyOffset) * scaleY),
          width: Math.round(box.w * scaleX),
          height: Math.round(box.h * scaleY)
        };

        const cropPath = path.join(cropsDir, `${key.replace(/\s+/g, "_")}.png`);
        await sharp(imagePath).extract(rect).toFile(cropPath);
        const ocrRes = await worker.recognize(cropPath);
        let text = ocrRes.data.text.trim();
        if (
          ["Bil Semasa", "Jumlah Perlu Dibayar", "Baki Terdahulu", "Cagaran", "Penggunaan (m3)"].includes(
            key
          )
        )
          text = cleanNumeric(text);
        results[key] = text;
        console.log(`📄 OCR ${key}: "${text}"`);
      } catch (err) {
        console.warn(`⚠️ OCR failed for ${key}: ${err.message}`);
        results[key] = "";
      }
    })
  );

  await worker.terminate();

  // 🧮 Compute Tempoh Bil / Bilangan Hari
  const start =
    normalizeDate(results["Bilangan Hari - Start"]) ||
    normalizeDate(results["Bilangan_Hari_-_Start"]);
  const end =
    normalizeDate(results["Bilangan Hari - End"]) ||
    normalizeDate(results["Bilangan_Hari_-_End"]);

  let bilDays = null,
    tempohBil = null;

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

  // 🧾 Combine final output
  let final = {
    "File Name": fileName,
    Region: region,
    ...results,
    ...(tempohBil ? { "Tempoh Bil": tempohBil } : {}),
    ...(bilDays ? { "Bilangan Hari": bilDays } : {})
  };

  // 📊 Region-specific post-processing
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

  // 🧾 Standardize keys & fill defaults
  const standardized = standardizeOutput(final);
  return standardized;
}

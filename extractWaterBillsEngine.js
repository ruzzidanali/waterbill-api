import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execSync } from "child_process";
import * as pdfjsLibRaw from "pdfjs-dist/legacy/build/pdf.js";
import { fileURLToPath } from "url";
import { processTemplateOCR } from "./modules/processTemplateOCR.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfjsLib = pdfjsLibRaw.default ?? pdfjsLibRaw;

const debugDir = path.join(__dirname, "debug_text");
const templatesDir = path.join(__dirname, "templates");
for (const d of [debugDir, templatesDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const designWidth = 2481;
const designHeight = 3509;

/* --------------------------------------------------
   📄 Convert PDF → PNG (native poppler)
-------------------------------------------------- */
export async function pdfToPNG(filePath) {
  const base = path.basename(filePath, ".pdf");
  const outPrefix = path.join(debugDir, base);
  const rawPng = `${outPrefix}.png`;

  console.log(`🧩 Running pdftoppm on: ${filePath}`);
  execSync(`pdftoppm -r 300 -singlefile -png "${filePath}" "${outPrefix}"`);
  await sharp(rawPng)
    .resize(designWidth, designHeight, { fit: "fill" })
    .toFile(rawPng);
  console.log(`✅ PNG created: ${rawPng}`);
  return rawPng;
}

/* --------------------------------------------------
   🧭 detectRegionHybrid
-------------------------------------------------- */
async function detectRegionHybrid(_, text) {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (/air\s*selangor/.test(t)) return "Selangor";
  if (/syarikat\s*air\s*melaka/.test(t) || /\bsamb\b/.test(t)) return "Melaka";
  if (/syarikat\s*air\s*negeri\s*sembilan/.test(t) || /\bsains\b/.test(t))
    return "Negeri-Sembilan";
  if (/syarikat\s*air\s*darul\s*aman/.test(t) || /\bsada\b/.test(t))
    return "Kedah";
  if (t.includes("ranhill") || t.includes("saj") || t.includes("johor"))
    return "Johor";
  return "unknown";
}

/* --------------------------------------------------
   📖 Simple OCR for region detection
-------------------------------------------------- */
async function quickOCR(pngPath) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const res = await worker.recognize(pngPath);
  await worker.terminate();
  return res.data.text;
}

/* --------------------------------------------------
   🚀 processPDF
-------------------------------------------------- */
export async function processPDF(filePath) {
  const fileName = path.basename(filePath);
  console.log(`🧾 Processing: ${fileName}`);

  // PDF → PNG
  const png = await pdfToPNG(filePath);

  // Extract region text
  const text = await quickOCR(png);
  const region = await detectRegionHybrid(filePath, text);
  if (region === "unknown") return { ok: false, message: "Unknown region" };

  // Load region template
  const templatePath = path.join(templatesDir, `${region}.json`);
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

  // Run OCR + parser
  return await processTemplateOCR(png, template, fileName, region);
}

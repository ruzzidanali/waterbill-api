import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import * as pdfjsLibRaw from "pdfjs-dist/legacy/build/pdf.js";
import { fileURLToPath } from "url";
import { processTemplateOCR } from "./modules/processTemplateOCR.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfjsLib = pdfjsLibRaw.default ?? pdfjsLibRaw;

// ✅ Worker setup for pdfjs
if (pdfjsLib.GlobalWorkerOptions) {
  const workerPath = path
    .resolve(__dirname, "./node_modules/pdfjs-dist/legacy/build/pdf.worker.js")
    .replace(/\\/g, "/");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
}

// 📂 Directory setup
const debugDir = path.join(__dirname, "debug_text");
const templatesDir = path.join(__dirname, "templates");
for (const d of [debugDir, templatesDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// 📐 Design base size
const designWidth = 2481;
const designHeight = 3509;

/* --------------------------------------------------
   🧠 extractPDFText()
-------------------------------------------------- */
async function extractPDFText(filePath) {
  try {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(i => i.str).join(" ") + "\n";
    }
    if (text.trim().length < 100) text = await runOCRText(filePath);
    return text;
  } catch {
    return await runOCRText(filePath);
  }
}

/* --------------------------------------------------
   📖 runOCRText() – fallback full OCR
-------------------------------------------------- */
async function runOCRText(pdfPath) {
  const png = await pdfToPNG(pdfPath);
  const worker = await createWorker("eng");
  const result = await worker.recognize(png);
  await worker.terminate();
  return result.data.text;
}

/* --------------------------------------------------
   🖼️ pdfToPNG()
-------------------------------------------------- */
async function pdfToPNG(pdfPath) {
  const base = path.basename(pdfPath, ".pdf");
  const outPrefix = path.join(debugDir, base);
  const rawPngPath = `${outPrefix}_raw.png`;
  const resizedPngPath = `${outPrefix}.png`;

  console.log("🧩 Running pdftoppm on:", pdfPath);
  execSync(`pdftoppm -r 300 -singlefile -png "${pdfPath}" "${outPrefix}_raw"`);
  console.log("🧾 Checking raw PNG:", fs.existsSync(rawPngPath) ? "✅ Found" : "❌ Missing");

  await sharp(rawPngPath)
    .resize(designWidth, designHeight, { fit: "fill" })
    .toFile(resizedPngPath);

  fs.unlinkSync(rawPngPath);
  console.log("✅ PNG created:", resizedPngPath);
  return resizedPngPath;
}

/* --------------------------------------------------
   🧭 detectRegionHybrid()
-------------------------------------------------- */
async function detectRegionHybrid(filePath, text) {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (/air\s*selangor/.test(t)) return "Selangor";
  if (/syarikat\s*air\s*melaka/.test(t) || /\bsamb\b/.test(t)) return "Melaka";
  if (/syarikat\s*air\s*negeri\s*sembilan/.test(t) || /\bsains\b/.test(t)) return "Negeri-Sembilan";
  if (/syarikat\s*air\s*darul\s*aman/.test(t) || /\bsada\b/.test(t)) return "Kedah";
  if (t.includes("ranhill") || t.includes("saj") || t.includes("darul ta'zim") || t.includes("johor"))
    return "Johor";

  console.log("🔎 Normal text scan failed → OCR header/footer check...");

  const base = path.basename(filePath, ".pdf");
  const tmpPng = await pdfToPNG(filePath);
  const tmpHeader = path.join(debugDir, `${base}_header.png`);
  const tmpFooter = path.join(debugDir, `${base}_footer.png`);

  try {
    const meta = await sharp(tmpPng).metadata();
    const cropHeight = Math.min(400, Math.round(meta.height * 0.25));

    await sharp(tmpPng)
      .extract({ left: 0, top: 0, width: meta.width, height: cropHeight })
      .toFile(tmpHeader);

    await sharp(tmpPng)
      .extract({ left: 0, top: Math.round(meta.height * 0.75), width: meta.width, height: cropHeight })
      .toFile(tmpFooter);

    const worker = await createWorker("eng");
    const [headRes, footRes] = await Promise.all([
      worker.recognize(tmpHeader),
      worker.recognize(tmpFooter),
    ]);
    await worker.terminate();

    const ocrCombined = (headRes.data.text + " " + footRes.data.text).toLowerCase();
    if (/ranhill|saj\s+sdn|saj\s+berhad|darul\s+ta'?zim|johor/.test(ocrCombined)) {
      console.log("📄 OCR detected Johor keywords → Region = Johor");
      return "Johor";
    }
  } catch (err) {
    console.warn("⚠️ OCR header/footer scan failed:", err.message);
  }

  return "unknown";
}

/* --------------------------------------------------
   🗺️ detectSelangorLayout()
-------------------------------------------------- */
async function detectSelangorLayout(region, imagePath) {
  if (region !== "Selangor") return region;
  const sampleBox = { left: 1600, top: 250, width: 800, height: 250 };
  const worker = await createWorker("eng");
  const tempCrop = path.join(debugDir, "layout_temp.png");
  await sharp(imagePath).extract(sampleBox).toFile(tempCrop);
  const res = await worker.recognize(tempCrop);
  await worker.terminate();
  const ocr = res.data.text.toLowerCase();
  if (ocr.includes("baharu") && ocr.includes("lama")) return "Selangor2";
  return "Selangor";
}

/* --------------------------------------------------
   🚀 processPDF()
-------------------------------------------------- */
export async function processPDF(filePath) {
  const fileName = path.basename(filePath);
  console.log(`🧾 Processing: ${fileName}`);

  // 1️⃣ Extract text
  const text = await extractPDFText(filePath);

  // 2️⃣ Detect region
  const region = await detectRegionHybrid(filePath, text);
  if (region === "unknown") {
    console.warn(`⚠️ Unknown region: ${fileName}`);
    return { ok: false, message: "Unknown region" };
  }

  // 3️⃣ Convert PDF → normalized PNG
  const png = await pdfToPNG(filePath);

  // 4️⃣ Detect special Selangor layout
  const regionChecked = await detectSelangorLayout(region, png);

  // 🗂️ Debug: show which templates are available
  console.log("🗂️ Templates found in /app/templates:", fs.readdirSync(templatesDir));

  // 5️⃣ Load correct template (Linux-safe lowercase)
  const templateFileName = `${regionChecked.toLowerCase()}.json`;
  const templatePath = path.join(templatesDir, templateFileName);

  if (!fs.existsSync(templatePath)) {
    console.error("❌ Template not found:", templatePath);
    throw new Error(`Missing template for region ${regionChecked}`);
  }

  console.log(`✅ Using template: ${templateFileName}`);
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

  // 6️⃣ Run OCR + parsing
  const result = await processTemplateOCR(png, template, fileName, regionChecked);

  // 7️⃣ Return standardized JSON
  return result;
}

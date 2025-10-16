import { execSync } from "child_process";
import fs from "fs";

export async function runNativeOCR(imagePath) {
  const outputTxt = imagePath.replace(/\.(png|jpg)$/, "");
  const cmd = `tesseract "${imagePath}" "${outputTxt}" -l eng --psm 6`;
  execSync(cmd);
  const text = fs.readFileSync(`${outputTxt}.txt`, "utf8");
  fs.unlinkSync(`${outputTxt}.txt`);
  return text.trim();
}

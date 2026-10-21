// Renders the launcher icons (Android mipmaps), the Play Store icon and icon.svg from icon-art.mjs.
// Needs Playwright with Chromium: node store/make-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { columnsSvg } from "./icon-art.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BG = "#14161a";
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [name, d] of Object.entries(DENSITIES)) {
  const dir = join(root, "android/res", `mipmap-${name}`);
  // Legacy icon: rounded square; adaptive layers: 108dp canvas with the art inside the safe zone.
  const legacy = 48 * d;
  await png(columnsSvg({ size: legacy, scale: 0.6 }).replace("<svg ", `<svg style="background:${BG};border-radius:${legacy * 0.18}px" `), legacy, join(dir, "ic_launcher.png"));
  await png(columnsSvg({ size: 108 * d, scale: 0.4 }), 108 * d, join(dir, "ic_launcher_foreground.png"));
  await png(columnsSvg({ size: 108 * d, scale: 0.4, accent: "#000", base: "#000" }), 108 * d, join(dir, "ic_launcher_monochrome.png"));
}
await png(columnsSvg({ size: 512, background: BG }), 512, join(root, "store/icon-512.png"));
await browser.close();

writeFileSync(join(root, "icon.svg"), columnsSvg({ size: 512, scale: 0.56 })
  .replace(/width="512" height="512" /, "")
  .replace(">", `>\n    <rect width="512" height="512" rx="96" fill="${BG}"/>`) + "\n");
console.log("Icons written.");

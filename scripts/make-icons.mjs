#!/usr/bin/env node
/**
 * 產生網站圖示，輸出成 src/icons.ts：SVG（現代瀏覽器）、ICO（16、32、48，給直接要 /favicon.ico 的
 * 瀏覽器與爬蟲）、180×180 PNG（iOS 加到主畫面）。
 *   用法：npm run make-icons
 *
 * 圖案是三個連在一起的圓，中間的大一點：二氧化碳分子（O=C=O）的示意。
 * SVG 與點陣版本由同一組幾何定義產生，改圖案時只改 CIRCLES 與 BOND。
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "./png.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "icons.ts");

const BLUE = [0x2f, 0x5d, 0x8a];
const WHITE = [0xff, 0xff, 0xff];

// 座標系是 32×32。
const RADIUS = 7;
const CIRCLES = [
  [6.5, 16, 2.8],
  [16, 16, 4.2],
  [25.5, 16, 2.8],
];
const BOND = { x0: 6.5, x1: 25.5, y: 16, half: 0.9 };

const SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='${RADIUS}' fill='#2f5d8a'/>` +
  `<path d='M${BOND.x0} ${BOND.y}H${BOND.x1}' stroke='#fff' stroke-width='${BOND.half * 2}'/>` +
  CIRCLES.map(([cx, cy, r]) => `<circle cx='${cx}' cy='${cy}' r='${r}' fill='#fff'/>`).join("") +
  "</svg>";

function inRoundRect(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), 32 - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), 32 - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS * RADIUS;
}

const inMark = (x, y) =>
  CIRCLES.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r) || (x >= BOND.x0 && x <= BOND.x1 && Math.abs(y - BOND.y) <= BOND.half);

/** 4×4 超取樣。opaque：不裁圓角、不透明，給 iOS（它自己會套遮罩）。 */
function render(size, { opaque = false } = {}) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0;
      let white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) * 32) / size;
          const y = ((py + (sy + 0.5) / SS) * 32) / size;
          if (opaque || inRoundRect(x, y)) {
            cover++;
            if (inMark(x, y)) white++;
          }
        }
      }
      const w = cover ? white / cover : 0;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(BLUE[c] * (1 - w) + WHITE[c] * w);
      out[o + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  return out;
}

function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size;
    e[1] = size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

const apple = encodePng(180, 180, 4, render(180, { opaque: true }));
const favicon = ico([16, 32, 48].map((size) => ({ size, data: encodePng(size, size, 4, render(size)) })));

await writeFile(
  OUT,
  `/**
 * 由 \`npm run make-icons\` 產生，請勿手改。圖案的定義在 scripts/make-icons.mjs。
 */
export const FAVICON_SVG =
  "${SVG}";
export const FAVICON_ICO_BASE64 =
  "${favicon.toString("base64")}";
export const APPLE_ICON_BASE64 =
  "${apple.toString("base64")}";
`,
  "utf-8",
);
process.stderr.write(`wrote icons (ico ${favicon.length} bytes, apple ${apple.length} bytes) -> ${OUT}\n`);

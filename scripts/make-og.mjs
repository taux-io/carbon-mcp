#!/usr/bin/env node
/**
 * 產生社群分享卡片用的 og:image，輸出成 src/og-image.ts（base64 常數）。
 *   用法：npm run make-og
 *
 * og:image 必須是 URL，不能是 data: URI，而 Worker 沒有靜態資產綁定，所以圖由 Worker 自己服務。
 *
 * 圖上沒有文字：畫字需要字型光柵化（標題含中文，要一套 CJK 字型），那是很大的相依。
 * 卡片的標題與描述本來就由 og:title 與 og:description 提供，圖只需要是可辨識的標記。
 * 構圖是一張「係數表」：一列一列長短不一的橫條，其中一列是亮的。
 * 刻意不畫下降的趨勢線或變小的柱體：那會被讀成「減碳成效」，而這個服務只提供係數與計算，
 * 不對成效做任何宣稱。
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "./png.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "og-image.ts");

const W = 1200;
const H = 630;

// 與 src/site.ts 深色配色同一組值，改配色時兩邊一起改。
const BG = [0x0e, 0x10, 0x13];
const DIM = [0x2f, 0x5d, 0x8a];
const BRIGHT = [0x8a, 0xb6, 0xe2];
const RULE = [0x28, 0x2c, 0x31];

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) px.set(BG, i * 3);

function rect(x, y, w, h, rgb) {
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(H, Math.round(y + h)); yy++) {
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(W, Math.round(x + w)); xx++) px.set(rgb, (yy * W + xx) * 3);
  }
}

// 每一列：名稱欄的橫條長度、數值欄的橫條長度。寫死的序列，建置產物才可重現。
const ROWS = [
  [0.62, 0.3],
  [0.44, 0.22],
  [0.78, 0.36],
  [0.52, 0.26],
  [0.7, 0.18],
  [0.38, 0.32],
];
const HIGHLIGHT = 2;
const LEFT = 150;
const NAME_W = 560;
const VALUE_X = 800;
const VALUE_W = 250;
const ROW_H = 30;
const PITCH = 68;
const TOP = (H - (ROWS.length * PITCH - (PITCH - ROW_H))) / 2;

ROWS.forEach(([name, value], i) => {
  const y = TOP + i * PITCH;
  const colour = i === HIGHLIGHT ? BRIGHT : DIM;
  rect(LEFT, y, ROW_H, ROW_H, colour);
  rect(LEFT + ROW_H + 24, y, NAME_W * name, ROW_H, colour);
  rect(VALUE_X + VALUE_W * (1 - value), y, VALUE_W * value, ROW_H, colour);
  if (i < ROWS.length - 1) rect(LEFT, y + ROW_H + (PITCH - ROW_H) / 2 - 1, W - LEFT * 2, 2, RULE);
});

const png = encodePng(W, H, 3, px);
await writeFile(
  OUT,
  `/**
 * 由 \`npm run make-og\` 產生，請勿手改。
 * 社群分享卡片的圖，${W}×${H} PNG，以 base64 內嵌，由 Worker 在 /og.png 服務。
 * 構圖與圖上沒有文字的理由見 scripts/make-og.mjs。
 */
export const OG_IMAGE_WIDTH = ${W};
export const OG_IMAGE_HEIGHT = ${H};
export const OG_IMAGE_BASE64 =
  "${png.toString("base64")}";
`,
  "utf-8",
);
process.stderr.write(`wrote ${png.length} byte PNG -> ${OUT}\n`);

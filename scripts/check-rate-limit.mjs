#!/usr/bin/env node
/**
 * 確認限流有在運作：用同一條連線連續送請求，應該在設定的上限附近開始得到 429。
 *
 * 一定要用同一條連線。Workers 的限流綁定是每台機器各自計數、背景同步的近似值，
 * 平行連線會散到不同機器上，2026-11-13 實測 600 次平行請求沒有一次被擋。
 * 用法：node scripts/check-rate-limit.mjs [baseUrl] [count]
 */
const base = (process.argv[2] ?? "https://carbon.taux.io").replace(/\/$/, "");
const count = Number(process.argv[3] ?? 200);
const counts = {};
let first = null;
for (let i = 1; i <= count; i++) {
  const res = await fetch(`${base}/api/v1/sources`);
  await res.arrayBuffer();
  counts[res.status] = (counts[res.status] ?? 0) + 1;
  if (res.status === 429 && first === null) first = i;
}
console.log(`${count} sequential requests:`, counts, first ? `first 429 at request ${first}` : "no 429");
process.exit(first ? 0 : 1);

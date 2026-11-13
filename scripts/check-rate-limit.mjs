#!/usr/bin/env node
/**
 * 確認限流有在運作：用同一條連線連續送請求，應該在 100 次上下開始得到 429。
 *
 * 限流有兩層（見 docs/deployment.md 的「限流」）。這支腳本用單一連線，所以兩層都可能先觸發：
 * Worker 的限流綁定（每分鐘 120 次，每台機器各自計數）或 zone 的 WAF 規則（每 10 秒 100 次）。
 * 只要有一層回 429 就算通過。要單獨驗證 WAF 那一層，得用平行連線。
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

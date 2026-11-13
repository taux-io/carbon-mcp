#!/usr/bin/env node
/**
 * 檢查用詞對照表（src/concepts.ts）裡的每個 keyword，在跑著的服務上都找得到係數。
 * 產品碳足跡的名稱來自環境部的即時資料，官方改名後對照會悄悄失效，這支腳本就是抓這個。
 * 用法：node scripts/check-concepts.mjs [baseUrl]   （需要 Node 24 以上，直接讀 TypeScript 原始檔）
 */
import { CONCEPTS } from "../src/concepts.ts";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
let failed = 0;

for (const concept of CONCEPTS) {
  for (const s of concept.selectors) {
    const url = new URL(`${base}/api/v1/factors`);
    url.searchParams.set("category", s.category);
    url.searchParams.set("limit", "1");
    if (s.keyword) url.searchParams.set("query", s.keyword);
    const body = await (await fetch(url)).json();
    const total = body.total ?? 0;
    if (total === 0) {
      failed++;
      console.log(`FAIL  ${concept.id}: ${s.category} ${s.keyword ?? "(all)"} matches no factor`);
    }
  }
}

console.log(failed ? `\n${failed} selector(s) match nothing` : `all ${CONCEPTS.reduce((n, c) => n + c.selectors.length, 0)} selectors match at least one factor`);
process.exit(failed ? 1 : 0);

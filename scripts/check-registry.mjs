#!/usr/bin/env node
/**
 * 比對官方 MCP Registry 上的條目與 repo 的 server.json：名稱與連線位址必須一致。
 * 連線位址若被改掉，所有從 registry 安裝的人都會連到別的地方，所以發布後應定期比對。
 * 用法：npm run check-registry   （尚未發布時會回報讀不到條目並以非零結束）
 */
import { readFile } from "node:fs/promises";

const REGISTRY = "https://registry.modelcontextprotocol.io";

export function registryProblems(entry, expected) {
  if (entry?.name !== expected.name) return [`registry 回的條目名稱是 ${JSON.stringify(entry?.name)}，預期 ${JSON.stringify(expected.name)}`];
  const got = Array.isArray(entry.remotes) ? entry.remotes : [];
  const same = got.length === expected.remotes.length && expected.remotes.every((r, i) => got[i]?.type === r.type && got[i]?.url === r.url);
  if (same) return [];
  const show = (rs) => (rs.length ? rs.map((r) => `${r?.type} ${r?.url}`).join("、") : "（沒有）");
  return [`registry 條目的連線位址與 repo 不一致。registry（版本 ${entry.version}）：${show(got)}；server.json：${show(expected.remotes)}。若不是你自己發布的，視為條目被竄改。`];
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const expected = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  const url = `${REGISTRY}/v0/servers/${encodeURIComponent(expected.name)}/versions/latest`;
  let problems;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    problems = registryProblems((await res.json()).server, expected);
  } catch (e) {
    problems = [`讀不到官方 MCP Registry 的條目（${e?.message ?? e}）。尚未發布時這是預期的結果。`];
  }
  console.log(`官方 MCP Registry 條目：${url}\n${problems.length ? problems.map((p) => `- ${p}`).join("\n") : "與 server.json 一致"}`);
  process.exit(problems.length ? 1 : 0);
}

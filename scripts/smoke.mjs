#!/usr/bin/env node
/**
 * 對一個跑起來的服務做端到端檢查（預設本機 wrangler dev）。
 * 用法：node scripts/smoke.mjs [baseUrl]
 * 本機先跑：npm run db:local && npx wrangler dev --test-scheduled，再觸發一次排程把資料寫進 D1：
 *   curl "http://127.0.0.1:8787/__scheduled?cron=30+19+*+*+*"
 */
const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const MODERN = "2026-07-28";
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
}

async function payload(res) {
  const text = await res.text();
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line.slice(5).trim());
  }
  return JSON.parse(text);
}

async function mcp(era, method, params = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  let body = { jsonrpc: "2.0", id: 1, method, params };
  if (era === "modern") {
    headers["MCP-Protocol-Version"] = MODERN;
    headers["Mcp-Method"] = method;
    if (typeof params.name === "string") headers["Mcp-Name"] = params.name;
    body = { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} } } };
  }
  const res = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  return payload(res);
}

const CALC = { factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "kWh", year: 2025 };

try {
  const health = await fetch(`${base}/health`);
  const h = await health.json();
  check("GET /health", health.status === 200 && h.database === "ok", JSON.stringify(h));

  for (const path of ["/", "/en", "/ja", "/tools", "/api/docs", "/privacy", "/llms.txt", "/llms-full.txt", "/robots.txt", "/sitemap.xml", "/og.png", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]) {
    const res = await fetch(`${base}${path}`);
    check(`GET ${path}`, res.status === 200, `${res.status}`);
  }

  const init = await mcp("legacy", "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  check("MCP initialize (legacy)", init.result?.serverInfo?.name === "taiwan-carbon-open-data", init.result?.protocolVersion ?? JSON.stringify(init.error));

  for (const era of ["legacy", "modern"]) {
    const list = await mcp(era, "tools/list");
    check(`MCP tools/list (${era})`, list.result?.tools?.length === 13, `${list.result?.tools?.length ?? JSON.stringify(list.error)} tools`);

    const call = await mcp(era, "tools/call", { name: "calculate_emissions", arguments: CALC });
    const data = call.result ? JSON.parse(call.result.content[0].text) : null;
    check(`MCP calculate_emissions (${era})`, data?.emissions_kg === "5592" && data?.factor?.value === "0.466", `emissions_kg=${data?.emissions_kg} factor=${data?.factor?.value} v${data?.factor?.version}`);

    const elec = await mcp(era, "tools/call", { name: "get_electricity_factor", arguments: { year: 2026 } });
    check(`MCP refuses an unpublished year (${era})`, elec.result?.isError === true);
  }

  const rest = await fetch(`${base}/api/v1/calculate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(CALC) });
  const r = await rest.json();
  check("REST POST /api/v1/calculate", rest.status === 200 && r.emissions_kg === "5592", `emissions_kg=${r.emissions_kg}`);

  const status = await (await fetch(`${base}/api/v1/status`)).json();
  for (const s of status.sources) console.log(`      ${s.id}: status=${s.status} health=${s.health} factors=${s.factor_count}${s.health_note ? ` note=${s.health_note}` : ""}`);
  check("REST GET /api/v1/status", status.sources?.length === 5);
} catch (e) {
  check("smoke run", false, e instanceof Error ? e.message : String(e));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

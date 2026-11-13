import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src/server";
import { importReviewed } from "../src/sync";
import { TOOLS } from "../src/tools";
import { createTestDb } from "./d1";

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
type Incoming = Parameters<typeof worker.fetch>[0];

let db: D1Database;
beforeAll(async () => {
  db = createTestDb();
  await importReviewed(db);
});

const send = (request: Request, env: Record<string, unknown> = { DB: db }) => worker.fetch(request as unknown as Incoming, env as never, ctx);
const get = (path: string, headers: Record<string, string> = {}) => send(new Request(`https://carbon.taux.io${path}`, { headers }));
const post = (path: string, body: unknown) =>
  send(new Request(`https://carbon.taux.io${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

type Era = "legacy" | "modern";
const MODERN = "2026-07-28";

function mcpRequest(era: Era, method: string, params: Record<string, unknown>) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  let body: unknown = { jsonrpc: "2.0", id: 1, method, params };
  if (era === "modern") {
    headers["MCP-Protocol-Version"] = MODERN;
    headers["Mcp-Method"] = method;
    if (typeof params.name === "string") headers["Mcp-Name"] = params.name;
    body = {
      jsonrpc: "2.0", id: 1, method,
      params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} } },
    };
  }
  return new Request("https://carbon.taux.io/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

async function readPayload(res: Response) {
  const text = await res.text();
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (!line) throw new Error(`no SSE data line in: ${text}`);
    return JSON.parse(line.slice(5).trim());
  }
  return JSON.parse(text);
}

describe.each<Era>(["legacy", "modern"])("MCP (%s protocol)", (era) => {
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await send(mcpRequest(era, method, params));
    expect(res.status).toBe(200);
    return readPayload(res);
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const payload = await rpc("tools/call", { name, arguments: args });
    if (payload.error) throw new Error(JSON.stringify(payload.error));
    return { isError: payload.result.isError === true, data: JSON.parse(payload.result.content[0].text) };
  };

  if (era === "legacy") {
    it("answers initialize with the server identity", async () => {
      const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
      expect(r.result.serverInfo.name).toBe("taiwan-carbon-open-data");
      expect(r.result.instructions).toContain("search_emission_factors");
    });
  }

  it("lists all thirteen tools as read-only, each with an input schema", async () => {
    const r = await rpc("tools/list");
    const tools = r.result.tools as { name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.length).toBe(13);
    expect(tools.every((t) => t.annotations.readOnlyHint && t.inputSchema)).toBe(true);
  });

  it("pings", async () => {
    const { data } = await call("ping");
    expect(data).toMatchObject({ status: "ok", service: "taiwan-carbon-open-data" });
  });

  it("answers the 2025 industry electricity factor from the database", async () => {
    const { data } = await call("get_electricity_factor", { year: 2025, usage_type: "industry_inventory" });
    expect(data.factors.map((f: { id: string; value: string }) => [f.id, f.value])).toEqual([["tw-electricity-2025-industry-inventory", "0.466"]]);
  });

  it("returns all three 2025 values and does not pick one when no usage is given", async () => {
    const { data } = await call("get_electricity_factor", { year: 2025 });
    expect(data.factors.map((f: { value: string }) => f.value).sort()).toEqual(["0.466", "0.467", "0.471"]);
    expect(data.notice).toContain("不會代為選擇");
  });

  it("says a year has one unsplit factor when a usage type is asked for 2024", async () => {
    const { data } = await call("get_electricity_factor", { year: 2024, usage_type: "industry_inventory" });
    expect(data.split_by_usage).toBe(false);
    expect(data.factors.map((f: { value: string }) => f.value)).toEqual(["0.474"]);
    expect(data.notice).toContain("沒有依用途劃分");
  });

  it("refuses to substitute another year for one that is not published", async () => {
    const { isError, data } = await call("get_electricity_factor", { year: 2026 });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("no_factor_for_year");
    expect(data.error.details.available_years).toContain(2025);
  });

  it("calculates 12,000 kWh as 5,592 kgCO2e with source, year and version", async () => {
    const { data } = await call("calculate_emissions", { factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "kWh", year: 2025 });
    expect(data).toMatchObject({ emissions_kg: "5592", emissions_t: "5.592", emissions_gas_basis: "CO2e" });
    expect(data.factor).toMatchObject({ value: "0.466", reference_year: 2025, version: 1 });
    expect(data.factor.source_url).toMatch(/^https:\/\/www\.moeaea\.gov\.tw\//);
    expect(data.disclaimer).toContain("非官方");
  });

  it("returns a tool error, not a guess, for a wrong year, an unknown factor and a missing heating value", async () => {
    const wrongYear = await call("calculate_emissions", { factor_id: "tw-electricity-2024", quantity: 1, quantity_unit: "kWh", year: 2025 });
    expect([wrongYear.isError, wrongYear.data.error.code]).toEqual([true, "year_mismatch"]);
    const unknown = await call("calculate_emissions", { factor_id: "nope", quantity: 1, quantity_unit: "kWh" });
    expect([unknown.isError, unknown.data.error.code]).toEqual([true, "factor_not_found"]);
    const diesel = await call("calculate_emissions", { factor_id: "moenv-ghg-2024-stationary-diesel", quantity: 500, quantity_unit: "L" });
    expect([diesel.isError, diesel.data.error.code]).toEqual([true, "missing_heating_value"]);
  });

  it("calculates diesel once the user supplies a heating value", async () => {
    const { data } = await call("calculate_emissions", {
      factor_id: "moenv-ghg-2024-stationary-diesel", quantity: "17.495", quantity_unit: "公秉",
      optional_context: { lower_heating_value: { value: 8500, unit: "kcal/L" } },
    });
    expect(Number(data.emissions_t).toFixed(4)).toBe("46.2866");
    expect(data.user_supplied.lower_heating_value.note).toContain("使用者提供");
  });

  it("batches electricity, diesel and water, and withholds the total when one item cannot be computed", async () => {
    const { data } = await call("calculate_batch", {
      items: [
        { factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "度" },
        { factor_id: "moenv-ghg-2024-stationary-diesel", quantity: 500, quantity_unit: "L" },
        { factor_id: "tpe-water-2025", quantity: 200, quantity_unit: "度" },
      ],
    });
    expect(data.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, true]);
    expect(data.total.available).toBe(false);
  });

  it("compares two years and separates activity from factor effects", async () => {
    const { data } = await call("compare_emissions", {
      baseline: { factor_id: "tw-electricity-2023", quantity: 10000, quantity_unit: "kWh" },
      comparison: { factor_id: "tw-electricity-2024", quantity: 9000, quantity_unit: "kWh" },
    });
    expect(data.result).toMatchObject({ difference_kg: "-674", method_changed: false });
  });

  it("searches, describes, versions and reports sources and status", async () => {
    const found = await call("search_emission_factors", { query: "柴油" });
    expect(found.data.total).toBe(3);
    const none = await call("search_emission_factors", { query: "衛生紙" });
    expect(none.data.message).toBe("目前沒有找到符合條件且已驗證的官方排放係數。");
    const detail = await call("get_emission_factor", { factor_id: "twc-water-2025" });
    expect(detail.data.factor.government_data.value).toBe("0.151");
    expect(detail.data.factor.service_curated.gas_basis).toBe("CO2");
    const versions = await call("list_factor_versions", { factor_id: "twc-water-2025" });
    expect(versions.data.versions.length).toBe(1);
    const sources = await call("list_data_sources");
    expect(sources.data.sources.length).toBe(5);
    const status = await call("check_factor_updates");
    expect(status.data.note).toContain("無法觸發寫入");
    const method = await call("get_methodology", { topic: "fuel_combustion" });
    expect(Object.keys(method.data.topics)).toEqual(["fuel_combustion"]);
  });

  it("rejects arguments that fail the schema", async () => {
    const payload = await rpc("tools/call", { name: "get_electricity_factor", arguments: { year: "二〇二五" } });
    expect(payload.error ?? payload.result.isError).toBeTruthy();
  });
});

describe("MCP transport guards", () => {
  it("rejects JSON-RPC batches before they reach the SDK", async () => {
    const res = await post("/mcp", [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    expect(res.status).toBe(400);
  });

  it("rejects an oversized body", async () => {
    const res = await post("/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "x".repeat(300 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("returns 429 when the rate limiter says no", async () => {
    const env = { DB: db, RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await send(mcpRequest("legacy", "tools/list", {}), env)).status).toBe(429);
    expect((await send(new Request("https://carbon.taux.io/api/v1/sources"), env)).status).toBe(429);
  });
});

describe("REST API", () => {
  it("returns the same calculation as the MCP tool", async () => {
    const res = await post("/api/v1/calculate", { factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "kWh", year: 2025 });
    expect(res.status).toBe(200);
    const data = await res.json() as { emissions_kg: string; factor: { value: string } };
    expect([data.emissions_kg, data.factor.value]).toEqual(["5592", "0.466"]);
  });

  it("maps failures to HTTP statuses", async () => {
    expect((await get("/api/v1/factors/nope")).status).toBe(404);
    expect((await get("/api/v1/electricity?year=2026")).status).toBe(404);
    expect((await get("/api/v1/electricity")).status).toBe(400);
    expect((await post("/api/v1/calculate", "not json")).status).toBe(400);
    expect((await post("/api/v1/calculate", { factor_id: "tw-electricity-2024", quantity: 1, quantity_unit: "公升" })).status).toBe(422);
    expect((await post("/api/v1/calculate", { factor_id: "x", quantity: 1, quantity_unit: "kWh", pad: "x".repeat(70 * 1024) })).status).toBe(413);
    expect((await post("/api/v1/sources", {})).status).toBe(405);
    expect((await get("/api/v1/unknown")).status).toBe(404);
  });

  it("searches with paging and reads one factor, its versions, sources and status", async () => {
    const page = await (await get("/api/v1/factors?query=%E9%9B%BB%E5%8A%9B&limit=5&offset=20")).json() as { total: number; factors: unknown[] };
    expect([page.total, page.factors.length]).toEqual([23, 3]);
    expect((await get("/api/v1/factors?limit=5000")).status).toBe(400);
    const one = await (await get("/api/v1/factors/tw-electricity-2024")).json() as { factor: { version: number } };
    expect(one.factor.version).toBe(1);
    expect((await get("/api/v1/factors/tw-electricity-2024/versions")).status).toBe(200);
    expect((await get("/api/v1/factors/tw-electricity-2024?version=9")).status).toBe(404);
    expect((await get("/api/v1/sources")).status).toBe(200);
    expect((await get("/api/v1/status")).status).toBe(200);
    expect((await get("/api/v1/electricity?year=2025&usage_type=residential_tariff")).status).toBe(200);
  });

  it("matches an activity description over REST and through the MCP tool alike", async () => {
    const res = await get("/api/v1/match?description=%E9%9B%BB%E8%B2%BB&unit=kWh&year=2025");
    expect(res.status).toBe(200);
    const rest = await res.json() as { requires_confirmation: boolean; candidates: { factor: { id: string } }[] };
    expect(rest.requires_confirmation).toBe(true);
    const viaTool = await send(mcpRequest("legacy", "tools/call", { name: "match_activity", arguments: { description: "電費", unit: "kWh", year: 2025 } }));
    const tool = JSON.parse((await readPayload(viaTool)).result.content[0].text) as typeof rest;
    expect(tool.candidates.map((c) => c.factor.id)).toEqual(rest.candidates.map((c) => c.factor.id));
    expect((await get("/api/v1/match")).status).toBe(400);
    expect((await get("/api/v1/match?description=%E5%93%A1%E5%B7%A5%E6%97%85%E9%81%8A")).status).toBe(404);
  });

  it("batches through REST", async () => {
    const res = await post("/api/v1/calculate/batch", { items: [{ factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "度" }, { factor_id: "tpe-water-2025", quantity: 200, quantity_unit: "度" }] });
    const data = await res.json() as { total: { available: boolean; emissions_kg: string } };
    expect(data.total).toMatchObject({ available: true, emissions_kg: "5602.04" });
  });

  it("has no write route: every mutating method is refused", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      for (const path of ["/api/v1/factors/tw-electricity-2024", "/api/v1/sources", "/api/v1/status"]) {
        const res = await send(new Request(`https://carbon.taux.io${path}`, { method }));
        expect([405, 404], `${method} ${path}`).toContain(res.status);
      }
    }
    const before = await (await get("/api/v1/factors/tw-electricity-2024")).json() as { factor: { version: number } };
    expect(before.factor.version).toBe(1);
  });

  it("allows cross-origin browser calls only from its own site", async () => {
    expect((await get("/api/v1/sources", { origin: "https://carbon.taux.io" })).headers.get("access-control-allow-origin")).toBe("https://carbon.taux.io");
    expect((await get("/api/v1/sources", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers 503 when no database is bound", async () => {
    expect((await send(new Request("https://carbon.taux.io/api/v1/sources"), {})).status).toBe(503);
  });
});

// 正式環境第一次部署後、排程還沒跑之前就是這個狀態。
describe("before any data has been loaded", () => {
  const empty = () => ({ DB: createTestDb() });
  const callEmpty = async (name: string, args: Record<string, unknown>) => {
    const res = await send(mcpRequest("legacy", "tools/call", { name, arguments: args }), empty());
    const payload = await readPayload(res);
    return { isError: payload.result.isError === true, data: JSON.parse(payload.result.content[0].text) };
  };

  it.each([
    ["get_electricity_factor", { year: 2025 }],
    ["search_emission_factors", { query: "電力" }],
    ["get_emission_factor", { factor_id: "tw-electricity-2025-industry-inventory" }],
    ["calculate_emissions", { factor_id: "tw-electricity-2025-industry-inventory", quantity: 1, quantity_unit: "kWh" }],
    ["list_factor_versions", { factor_id: "tw-electricity-2025-industry-inventory" }],
  ])("%s says the service has no data yet, not that the government has not published", async (name, args) => {
    const { isError, data } = await callEmpty(name, args);
    expect(isError).toBe(true);
    expect(data.error.code).toBe("data_not_loaded");
    expect(data.error.message).toContain("資料尚未載入");
    expect(JSON.stringify(data)).not.toContain("尚未公布");
  });

  it("answers 503 over REST", async () => {
    const res = await send(new Request("https://carbon.taux.io/api/v1/electricity?year=2025"), empty());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("data_not_loaded");
  });
});

describe("with data loaded", () => {
  it("still reports a genuinely unpublished year as not found", async () => {
    const res = await get("/api/v1/electricity?year=2026");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_factor_for_year");
  });
});

describe("site routes", () => {
  it("reports health with the database state", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", database: "ok" });
    expect((await send(new Request("https://carbon.taux.io/health"), {})).status).toBe(503);
  });

  it.each(["/", "/en", "/ja", "/tools", "/api/docs", "/llms.txt", "/llms-full.txt", "/robots.txt", "/sitemap.xml"])("serves %s with security headers", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await res.text()).length).toBeGreaterThan(50);
  });

  it("does not serve the homepage for unknown paths", async () => {
    for (const path of ["/admin", "/.env", "/wp-login.php"]) expect((await get(path)).status).toBe(404);
  });
});

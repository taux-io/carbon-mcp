import Big from "big.js";
import { beforeAll, describe, expect, it } from "vitest";

import { buildInventory, type InventoryItem } from "../src/inventory";
import worker from "../src/server";
import { importReviewed, syncCarbonFootprint } from "../src/sync";
import { createTestDb } from "./d1";

const NOW = new Date("2026-11-13T00:00:00Z");

let db: D1Database;
beforeAll(async () => {
  db = createTestDb();
  await importReviewed(db);
  const record = { name: "聚丙烯(PP)", coe: "1.95", unit: "公斤(kg)", departmentname: "環境部", announcementyear: "2015", scpoe3_iso: "類別4.1", scpoe3_ghg: "類別1" };
  await syncCarbonFootprint(db, "k", (async () => new Response(JSON.stringify([record]))) as unknown as typeof fetch);
});

const ELECTRICITY: InventoryItem = { label: "總公司電費", factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "度" };
// 環境部盤查作業指引的算例：柴油 17.495 公秉、8,500 kcal/L，合計 46.2866 公噸 CO2e。
const DIESEL: InventoryItem = { label: "緊急發電機", factor_id: "moenv-ghg-2024-stationary-diesel", quantity: "17.495", quantity_unit: "公秉", context: { lower_heating_value: { value: 8500, unit: "kcal/L" } } };
const WATER_TPE: InventoryItem = { label: "水費", factor_id: "tpe-water-2025", quantity: 200, quantity_unit: "度" };
const WATER_TWC: InventoryItem = { label: "水費", factor_id: "twc-water-2025", quantity: 200, quantity_unit: "度" };

const build = (items: InventoryItem[], year?: number) => buildInventory(db, items, year, NOW);
const scopeOf = (inv: Awaited<ReturnType<typeof build>>, n: 1 | 2 | 3) => inv.scopes.find((s) => s.scope === n)!;

describe("a typical office inventory", () => {
  it("groups electricity, diesel and water into Scopes 2, 1 and 3 with subtotals", async () => {
    const inv = await build([ELECTRICITY, DIESEL, WATER_TPE], 2025);
    expect(scopeOf(inv, 1).items.map((i) => i.label)).toEqual(["緊急發電機"]);
    expect(scopeOf(inv, 2).items.map((i) => i.label)).toEqual(["總公司電費"]);
    expect(scopeOf(inv, 3).items.map((i) => i.label)).toEqual(["水費"]);
    expect(scopeOf(inv, 2).subtotal).toMatchObject({ available: true, emissions_kg: "5592", emissions_t: "5.592" });
    expect(scopeOf(inv, 3).subtotal.emissions_kg).toBe("10.04");
    expect(new Big(scopeOf(inv, 1).subtotal.emissions_t!).toFixed(4)).toBe("46.2866");
    expect(inv.completeness).toEqual({ items: 3, calculated: 3, failed: 0 });
  });

  it("totals Scope 1 and 2, and all scopes, as the exact sum of the subtotals", async () => {
    const inv = await build([ELECTRICITY, DIESEL, WATER_TPE], 2025);
    const s1 = new Big(scopeOf(inv, 1).subtotal.emissions_kg!);
    expect(inv.scope_1_and_2_total.emissions_kg).toBe(s1.plus("5592").toFixed());
    expect(inv.total_all_scopes.emissions_kg).toBe(s1.plus("5592").plus("10.04").toFixed());
  });

  it("splits Scope 1 by gas, matching the official worked example", async () => {
    const inv = await build([DIESEL]);
    const gas = scopeOf(inv, 1).by_gas_kg_co2e!;
    expect([gas.CO2, gas.CH4, gas.N2O].map((v) => new Big(v).div(1000).toFixed(4))).toEqual(["46.1353", "0.0523", "0.0990"]);
  });

  it("carries the factor version and source for every line", async () => {
    const inv = await build([ELECTRICITY]);
    expect(scopeOf(inv, 2).items[0]).toMatchObject({ factor_version: 1, classified_by: "default", activity: "12000 kWh" });
    expect(scopeOf(inv, 2).items[0].source_url).toMatch(/^https:\/\//);
  });

  it("reports an empty scope as zero rather than omitting it", async () => {
    const inv = await build([ELECTRICITY]);
    expect(scopeOf(inv, 1).subtotal).toMatchObject({ available: true, emissions_kg: "0", item_count: 0 });
  });
});

describe("refrigerant leakage in the inventory", () => {
  const AC: InventoryItem = { label: "辦公室冷氣 R-32", factor_id: "moenv-gwp-2024-hfc-32", quantity: 20, quantity_unit: "kg", context: { refrigerant: { basis: "charge", leak_rate_percent: 5, equipment_type: "residential_commercial_ac" } } };

  it("puts refrigerant leakage in Scope 1 and adds it to the Scope 1+2 total", async () => {
    const inv = await build([ELECTRICITY, AC], 2025);
    expect(scopeOf(inv, 1).items[0]).toMatchObject({ label: "辦公室冷氣 R-32", emissions_kg: "677", factor_type: "fugitive_emission" });
    expect(inv.scope_1_and_2_total).toMatchObject({ available: true, emissions_kg: "6269" });
  });

  it("splits Scope 1 by gas across combustion and refrigerants, summing to the subtotal", async () => {
    const inv = await build([DIESEL, AC]);
    const gas = scopeOf(inv, 1).by_gas_kg_co2e!;
    expect(Object.keys(gas).sort()).toEqual(["CH4", "CO2", "HFCs", "N2O"]);
    expect(gas.HFCs).toBe("677");
    const sum = Object.values(gas).reduce((s, v) => s.plus(v), new Big(0));
    expect(sum.toFixed()).toBe(scopeOf(inv, 1).subtotal.emissions_kg);
  });

  it("withholds the Scope 1 subtotal when the refrigerant basis is missing", async () => {
    const inv = await build([{ label: "冷氣", factor_id: "moenv-gwp-2024-hfc-32", quantity: 20, quantity_unit: "kg" }]);
    expect(inv.failed_items[0]).toMatchObject({ scope: 1, error: { code: "missing_refrigerant_basis" } });
    expect(scopeOf(inv, 1).subtotal.available).toBe(false);
  });

  it("lists biogenic CO2 on the line and keeps it out of the subtotal", async () => {
    const wood: InventoryItem = { label: "木質顆粒鍋爐", factor_id: "moenv-ghg-2024-stationary-wood-wood-waste", quantity: 1, quantity_unit: "t", context: { lower_heating_value: { value: 4000, unit: "kcal/kg" } } };
    const inv = await build([wood]);
    const line = scopeOf(inv, 1).items[0];
    expect(new Big(line.biogenic_co2_kg!).gt(line.emissions_kg)).toBe(true);
    expect(scopeOf(inv, 1).subtotal.emissions_kg).toBe(line.emissions_kg);
    expect(scopeOf(inv, 1).by_gas_kg_co2e!.CO2).toBeUndefined();
  });
});

describe("totals that would mislead are withheld", () => {
  it("does not add CO2 to CO2e: the all-scope total is withheld, Scope 1+2 still stands", async () => {
    const inv = await build([ELECTRICITY, WATER_TWC]);
    expect(scopeOf(inv, 3).subtotal).toMatchObject({ available: true, emissions_gas_basis: "CO2" });
    expect(inv.total_all_scopes.available).toBe(false);
    expect(inv.total_all_scopes.emissions_kg).toBeUndefined();
    expect(inv.scope_1_and_2_total).toMatchObject({ available: true, emissions_kg: "5592" });
  });

  it("withholds only the subtotals that a failed item would leave short", async () => {
    const noHeatingValue: InventoryItem = { label: "公務車", factor_id: "moenv-ghg-2024-mobile-diesel", quantity: 500, quantity_unit: "L" };
    const inv = await build([ELECTRICITY, noHeatingValue, WATER_TPE]);
    expect(inv.failed_items).toMatchObject([{ index: 1, label: "公務車", scope: 1, error: { code: "missing_heating_value" } }]);
    expect(scopeOf(inv, 1).subtotal.available).toBe(false);
    expect(scopeOf(inv, 2).subtotal.available).toBe(true);
    expect(scopeOf(inv, 3).subtotal.available).toBe(true);
    expect(inv.scope_1_and_2_total.available).toBe(false);
    expect(inv.total_all_scopes.available).toBe(false);
  });

  it("withholds cross-scope totals when an item's factor is unknown", async () => {
    const inv = await build([ELECTRICITY, { factor_id: "nope", quantity: 1, quantity_unit: "kg" }]);
    expect(inv.failed_items[0]).toMatchObject({ scope: null, error: { code: "factor_not_found" } });
    expect(scopeOf(inv, 2).subtotal.available).toBe(true);
    expect(inv.scope_1_and_2_total.available).toBe(false);
  });

  it("keeps product carbon footprints out of the all-scope total", async () => {
    const { searchFactors } = await import("../src/store");
    const pp = (await searchFactors(db, { query: "聚丙烯", limit: 1, offset: 0 })).items[0];
    const inv = await build([ELECTRICITY, { label: "PP 採購", factor_id: pp.id, quantity: 250, quantity_unit: "kg" }]);
    expect(scopeOf(inv, 3).subtotal).toMatchObject({ available: true, emissions_kg: "487.5" });
    expect(inv.total_all_scopes.available).toBe(false);
    expect(inv.total_all_scopes.withheld_reasons!.join()).toContain("產品碳足跡");
    expect(inv.scope_1_and_2_total.available).toBe(true);
  });
});

describe("year and scope handling", () => {
  it("applies the inventory year to items that do not set their own", async () => {
    const inv = await build([{ factor_id: "tw-electricity-2024", quantity: 100, quantity_unit: "kWh" }], 2025);
    expect(inv.failed_items[0].error.code).toBe("year_mismatch");
  });

  it("warns when the factors come from different years", async () => {
    const inv = await build([ELECTRICITY, { factor_id: "tpe-water-2024", quantity: 1, quantity_unit: "度" }]);
    expect(inv.warnings.join()).toContain("適用年度不一致");
  });

  it("lets the user move an item to another scope and says so", async () => {
    const inv = await build([{ ...ELECTRICITY, label: "承租場所電費", scope: 3 }]);
    expect(scopeOf(inv, 2).items).toEqual([]);
    expect(scopeOf(inv, 3).items[0]).toMatchObject({ label: "承租場所電費", classified_by: "user" });
    expect(inv.warnings.join()).toContain("使用者指定");
  });
});

describe("transport", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const body = { inventory_year: 2025, items: [{ label: "電費", factor_id: "tw-electricity-2025-industry-inventory", quantity: 12000, quantity_unit: "度" }] };
  const post = (payload: unknown) =>
    worker.fetch(new Request("https://carbon.taux.io/api/v1/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }) as never, { DB: db } as never, ctx);

  it("returns the same inventory over REST and through the MCP tool", async () => {
    const rest = (await (await post(body)).json()) as { scope_1_and_2_total: { emissions_kg: string } };
    const res = await worker.fetch(
      new Request("https://carbon.taux.io/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "build_inventory", arguments: body } }),
      }) as never,
      { DB: db } as never,
      ctx,
    );
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const tool = JSON.parse(JSON.parse(line ? line.slice(5) : text).result.content[0].text) as typeof rest;
    expect([rest.scope_1_and_2_total.emissions_kg, tool.scope_1_and_2_total.emissions_kg]).toEqual(["5592", "5592"]);
  });

  it("rejects an invalid scope and an empty list", async () => {
    expect((await post({ items: [{ ...body.items[0], scope: 4 }] })).status).toBe(400);
    expect((await post({ items: [] })).status).toBe(400);
  });
});

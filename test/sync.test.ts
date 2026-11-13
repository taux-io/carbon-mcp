import { beforeEach, describe, expect, it } from "vitest";

import { FACTORS } from "../src/data/reviewed";
import { getFactor, latestJobs, listSources, searchFactors } from "../src/store";
import { cfpToFactor, crossCheckElectricity, importReviewed, parseElectricityCsv, syncCarbonFootprint } from "../src/sync";
import { createTestDb } from "./d1";

const NOW = () => new Date("2026-11-13T00:00:00Z");

let db: D1Database;
beforeEach(async () => {
  db = createTestDb();
  await importReviewed(db, NOW);
});

const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
const source = async (id: string) => (await listSources(db)).find((s) => s.id === id)!;
const cfpCount = async () => (await searchFactors(db, { category: "product_footprint", limit: 50, offset: 0 })).total;

/** 以已審核的數值組出能源署 CSV；overrides 用來模擬官方更新。 */
function electricityCsv(overrides: Record<number, string> = {}): string {
  const rows = new Map<number, string>();
  for (const f of FACTORS) {
    if (f.category === "electricity" && (f.variant === "single" || f.variant === "utility_average")) rows.set(f.reference_year!, f.value!);
  }
  for (const [y, v] of Object.entries(overrides)) rows.set(Number(y), v);
  return "﻿西元年,能源密集度,電力排碳係數(公斤CO2e/度)\r\n" + [...rows].map(([y, v]) => `${y},1.23,${v}`).join("\r\n");
}

describe("reviewed import", () => {
  it("loads every reviewed factor and records a job per source", async () => {
    expect((await getFactor(db, "tw-electricity-2025-industry-inventory"))!.value).toBe("0.466");
    const jobs = await latestJobs(db);
    expect(jobs.filter((j) => j.kind === "reviewed_import").map((j) => j.status)).toEqual(["success", "success", "success", "success"]);
    expect((await source("moea-electricity")).last_success_at).toBe(NOW().toISOString());
  });

  it("changes nothing when run again", async () => {
    const again = await importReviewed(db, () => new Date("2027-01-01T00:00:00Z"));
    expect(Object.values(again).map((o) => o.records_changed)).toEqual([0, 0, 0, 0]);
  });
});

describe("electricity cross-check", () => {
  it("passes when the official CSV agrees, including trailing-zero differences", async () => {
    const r = await crossCheckElectricity(db, respond(electricityCsv({ 2016: "0.53" })), NOW);
    expect(r.status).toBe("success");
    expect((await source("moea-electricity")).health).toBe("ok");
  });

  it("flags a new year for review without writing a factor", async () => {
    const r = await crossCheckElectricity(db, respond(electricityCsv({ 2026: "0.45" })), NOW);
    expect(r.status).toBe("review_needed");
    expect(r.error).toContain("2026");
    expect((await source("moea-electricity")).health).toBe("review_needed");
    expect(await getFactor(db, "tw-electricity-2026")).toBeNull();
  });

  it("flags a changed value and leaves the stored factor alone", async () => {
    const r = await crossCheckElectricity(db, respond(electricityCsv({ 2024: "0.480" })), NOW);
    expect(r.status).toBe("review_needed");
    expect((await getFactor(db, "tw-electricity-2024"))!.value).toBe("0.474");
  });

  it("marks the source stale when the upstream is down or blocked", async () => {
    const r = await crossCheckElectricity(db, respond("Forbidden", 403), NOW);
    expect(r.status).toBe("failed");
    const s = await source("moea-electricity");
    expect([s.health, s.factor_count]).toEqual(["stale", 23]);
  });

  it("fails on a changed column layout instead of reading the wrong column", () => {
    expect(() => parseElectricityCsv("年,係數\n2024,0.474")).toThrow();
    expect(() => parseElectricityCsv("<html>error</html>")).toThrow();
  });
});

const record = (name: string, coe: string, unit = "公斤") => ({ name, coe, unit, departmentname: "某公司", announcementyear: "2023", scpoe3_iso: "類別4", scpoe3_ghg: "類別1" });

describe("carbon footprint sync", () => {
  it("is skipped without an API key", async () => {
    const r = await syncCarbonFootprint(db, undefined, respond("[]"), NOW);
    expect(r.status).toBe("skipped");
    expect((await source("moenv-cfp")).status).toBe("pending_key");
  });

  it("treats the 200-status missing-key message as a failure", async () => {
    const r = await syncCarbonFootprint(db, "k", respond("api_key 不存在。"), NOW);
    expect(r.status).toBe("failed");
    expect(await cfpCount()).toBe(0);
  });

  it("never stores or serves the API key when a fetch fails", async () => {
    const key = "SECRET-KEY-123";
    const throwing = (async (url: string) => {
      throw new Error(`fetch failed: ${url}`);
    }) as unknown as typeof fetch;
    const r = await syncCarbonFootprint(db, key, throwing, NOW);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("api_key=[已遮蔽]");
    const stored = JSON.stringify([await listSources(db), await latestJobs(db)]);
    expect(stored).not.toContain(key);
  });

  it("imports valid records and activates the source", async () => {
    const page = JSON.stringify({ records: [record("聚乙烯塑膠粒", "1.87"), record("衛生紙", "0.52", "包")] });
    const r = await syncCarbonFootprint(db, "k", respond(page), NOW);
    expect(r).toMatchObject({ status: "success", records_ok: 2 });
    expect((await source("moenv-cfp")).status).toBe("active");
    const { items } = await searchFactors(db, { query: "塑膠", limit: 10, offset: 0 });
    expect(items.map((f) => [f.value, f.denominator_unit, f.calculability, f.reference_year, f.announcement_year])).toEqual([["1.87", "kg", "direct", null, 2023]]);
    const tissue = (await searchFactors(db, { query: "衛生紙", limit: 10, offset: 0 })).items[0];
    expect([tissue.denominator_unit, tissue.calculability]).toEqual([null, "lookup_only"]);
  });

  it("stays active after the next reviewed import", async () => {
    await syncCarbonFootprint(db, "k", respond(JSON.stringify([record("聚乙烯塑膠粒", "1.87")])), NOW);
    await importReviewed(db, NOW);
    expect((await source("moenv-cfp")).status).toBe("active");
  });

  it.each([
    ["an empty result", "[]"],
    ["a non-numeric value", JSON.stringify([record("A", "N/A")])],
    ["a record without a unit", JSON.stringify([record("A", "1", "")])],
    ["indistinguishable duplicate records", JSON.stringify([record("A", "1"), record("A", "2")])],
    ["an unexpected envelope", JSON.stringify({ result: "ok" })],
  ])("writes nothing on %s", async (_name, body) => {
    await syncCarbonFootprint(db, "k", respond(JSON.stringify([record("既有係數", "3")])), NOW);
    const r = await syncCarbonFootprint(db, "k", respond(body), NOW);
    expect(r.status).toBe("failed");
    expect(await cfpCount()).toBe(1);
    expect((await source("moenv-cfp")).health).toBe("stale");
  });

  it("writes nothing when the record count collapses", async () => {
    const many = Array.from({ length: 10 }, (_, i) => record(`係數${i}`, "1"));
    await syncCarbonFootprint(db, "k", respond(JSON.stringify(many)), NOW);
    const r = await syncCarbonFootprint(db, "k", respond(JSON.stringify(many.slice(0, 3))), NOW);
    expect(r.status).toBe("failed");
    expect(await cfpCount()).toBe(10);
  });

  it("gives the same record the same ID every time", async () => {
    const a = await cfpToFactor(record("聚乙烯塑膠粒", "1.87"));
    const b = await cfpToFactor({ ...record("聚乙烯塑膠粒", "1.90") });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^cfp-[0-9a-f]{16}$/);
  });
});

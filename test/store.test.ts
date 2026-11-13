import { beforeEach, describe, expect, it } from "vitest";

import { DOCUMENTS, FACTORS, SOURCES } from "../src/data/reviewed";
import {
  availableYears, electricityFactors, getFactor, getFactorVersion, listSources, listVersions, searchFactors,
  upsertFactors, upsertSources,
} from "../src/store";
import { createTestDb } from "./d1";

const T1 = new Date("2026-11-13T00:00:00Z");
const T2 = new Date("2027-06-01T00:00:00Z");

let db: D1Database;
beforeEach(async () => {
  db = createTestDb();
  await upsertSources(db, SOURCES, DOCUMENTS);
  await upsertFactors(db, FACTORS, "審核後匯入", T1);
});

const search = (query: string, extra = {}) => searchFactors(db, { query, limit: 50, offset: 0, ...extra });

describe("reviewed data", () => {
  it("has unique, stable factor IDs", () => {
    expect(new Set(FACTORS.map((f) => f.id)).size).toBe(FACTORS.length);
    expect(FACTORS.map((f) => f.id)).toContain("tw-electricity-2025-industry-inventory");
  });

  it("points every factor at a registered source and document", () => {
    for (const f of FACTORS) {
      expect(SOURCES.some((s) => s.id === f.source_id), f.id).toBe(true);
      expect(DOCUMENTS.some((d) => d.id === f.document_id), f.id).toBe(true);
      expect(f.source_url, f.id).toMatch(/^https:\/\//);
    }
  });

  it("never records an announcement date the documents do not show", () => {
    for (const f of FACTORS) {
      const doc = DOCUMENTS.find((d) => d.id === f.document_id)!;
      if (f.announcement_date !== null) expect(f.announcement_date, f.id).toBe(doc.published_date);
    }
  });
});

describe("versioning", () => {
  it("is idempotent: importing the same data again changes nothing", async () => {
    const again = await upsertFactors(db, FACTORS, "審核後匯入", T2);
    expect(again).toEqual({ inserted: 0, updated: 0, unchanged: FACTORS.length });
    expect((await getFactor(db, "tw-electricity-2024"))!.retrieved_at).toBe(T1.toISOString());
  });

  it("keeps the old version when a value changes", async () => {
    const revised = FACTORS.map((f) => (f.id === "tw-electricity-2024" ? { ...f, value: "0.475" } : f));
    const r = await upsertFactors(db, revised, "官方更正", T2);
    expect(r).toMatchObject({ updated: 1, inserted: 0 });

    const current = (await getFactor(db, "tw-electricity-2024"))!;
    expect([current.value, current.version]).toEqual(["0.475", 2]);
    expect((await getFactorVersion(db, "tw-electricity-2024", 1))!.value).toBe("0.474");

    const versions = await listVersions(db, "tw-electricity-2024");
    expect(versions.map((v) => [v.version, v.value, v.is_current])).toEqual([[2, "0.475", true], [1, "0.474", false]]);
    expect(versions[0].change_reason).toBe("官方更正");
  });

  it("refuses duplicate IDs in one write", async () => {
    await expect(upsertFactors(db, [FACTORS[0], FACTORS[0]], "x", T2)).rejects.toThrow();
  });
});

describe("search", () => {
  it("finds electricity by 電力, 用電, and electricity", async () => {
    for (const q of ["電力", "用電", "electricity"]) {
      const r = await search(q, { year: 2025 });
      expect(r.items.map((f) => f.id).sort(), q).toEqual([
        "tw-electricity-2025-industry-inventory", "tw-electricity-2025-residential-tariff", "tw-electricity-2025-utility-average",
      ]);
    }
  });

  it("matches an alias inside a whole sentence", async () => {
    const r = await search("辦公室一年的用電", { year: 2024 });
    expect(r.items.map((f) => f.id)).toEqual(["tw-electricity-2024"]);
  });

  it("keeps stationary and mobile diesel apart, and the three mobile gasoline variants apart", async () => {
    const diesel = await search("柴油");
    expect(diesel.items.map((f) => f.id).sort()).toEqual(["moenv-ghg-2024-mobile-diesel", "moenv-ghg-2024-stationary-diesel"]);
    const gasoline = await search("汽油", { factor_type: "mobile_combustion" });
    expect(gasoline.total).toBe(3);
    expect(new Set(gasoline.items.map((f) => JSON.stringify(f.components))).size).toBe(3);
  });

  it("returns water factors from both utilities without merging them", async () => {
    const r = await search("自來水", { year: 2025 });
    expect(r.items.map((f) => [f.id, f.gas_basis]).sort()).toEqual([["tpe-water-2025", "CO2e"], ["twc-water-2025", "CO2"]]);
  });

  it("returns nothing rather than a near match for an unknown term", async () => {
    expect((await search("衛生紙")).total).toBe(0);
  });

  it("does not match short or English aliases as substrings of unrelated words", async () => {
    for (const q of ["水泥", "電池", "wastewater", "幫我查水泥的碳足跡"]) expect((await search(q)).total, q).toBe(0);
  });

  it("pages and caps the page size", async () => {
    const all = await search("電力", { limit: 500 });
    expect(all.items.length).toBe(23);
    const page = await search("電力", { limit: 5, offset: 20 });
    expect([page.total, page.items.length]).toEqual([23, 3]);
  });

  it("treats LIKE wildcards in the query as literal text", async () => {
    expect((await search("%")).total).toBe(0);
  });
});

describe("lookups", () => {
  it("returns three electricity factors for 2025 and one for 2024", async () => {
    expect((await electricityFactors(db, 2025)).length).toBe(3);
    expect((await electricityFactors(db, 2024)).map((f) => f.value)).toEqual(["0.474"]);
    expect(await electricityFactors(db, 2030)).toEqual([]);
  });

  it("lists the years available for a factor family", async () => {
    const years = await availableYears(db, (await getFactor(db, "tw-electricity-2024"))!);
    expect([years[0], years.at(-1), years.length]).toEqual([2005, 2025, 21]);
  });

  it("counts factors per source and shows the pending carbon footprint source as empty", async () => {
    const sources = Object.fromEntries((await listSources(db)).map((s) => [s.id, [s.status, s.factor_count]]));
    expect(sources["moenv-cfp"]).toEqual(["pending_key", 0]);
    expect(sources["moea-electricity"]).toEqual(["active", 23]);
    expect(sources["moenv-ghg-factors"]).toEqual(["active", 10]);
  });
});

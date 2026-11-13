import { beforeAll, describe, expect, it } from "vitest";

import { CONCEPTS, relatedTerms } from "../src/concepts";
import { matchActivity } from "../src/match";
import { search } from "../src/service";
import { importReviewed, syncCarbonFootprint } from "../src/sync";
import { createTestDb } from "./d1";

/** 名稱與單位取自環境部 CFP_P_02 的實際紀錄；數值只有測試中斷言到的才是實際值。 */
const cfp = (name: string, coe: string, unit: string, departmentname = "環境部", announcementyear = "2020") => ({ name, coe, unit, departmentname, announcementyear, scpoe3_iso: "類別4.1", scpoe3_ghg: "類別1" });
const CFP_FIXTURE = [
  cfp("聚丙烯(PP)", "1.95", "公斤(kg)", "環境部", "2015"),
  cfp("聚丙烯(PP)", "2.01", "公斤(kg)", "經濟部工業局", "2013"),
  cfp("線性低密度聚乙烯(LLDPE)", "2.02", "公斤(kg)"),
  cfp("再生料-廢容器-PET廢塑膠片", "0.35", "公斤(kg)"),
  cfp("抽取式衛生紙", "0.003342", "抽"),
  cfp("原生木漿影印紙", "1", "公斤(kg)"),
  cfp("原生木漿影印紙", "1", "包"),
  cfp("車用汽油(於移動源使用，2020)", "1", "公升(L)"),
  cfp("營業大貨車(柴油)", "1", "延噸公里(tkm)"),
  cfp("電力碳足跡(2021)", "1", "度(kwh)"),
];

let db: D1Database;
beforeAll(async () => {
  db = createTestDb();
  await importReviewed(db);
  const respond = (async () => new Response(JSON.stringify(CFP_FIXTURE))) as unknown as typeof fetch;
  await syncCarbonFootprint(db, "k", respond);
});

type Match = Extract<Awaited<ReturnType<typeof matchActivity>>, { ok: true }>;
const match = async (description: string, extra: { unit?: string; year?: number; limit?: number } = {}): Promise<Match> => {
  const r = await matchActivity(db, { description, ...extra });
  if (!r.ok) throw new Error(`expected candidates, got ${r.error.code}`);
  return r;
};
const names = (m: Match) => m.candidates.map((c) => c.factor.name);

describe("plastic resin, the case literal search cannot answer", () => {
  it("literal search finds nothing for 塑膠原料 but points to the names to try", async () => {
    const r = await search(db, { query: "塑膠原料" });
    if (!("total" in r)) throw new Error("expected a search result");
    expect(r.total).toBe(0);
    expect(r.related_terms).toEqual(expect.arrayContaining(["聚丙烯", "聚乙烯"]));
    expect(r.related_terms_note).toContain("非官方");
  });

  it("match_activity lists polypropylene and polyethylene as candidates and does not pick one", async () => {
    const m = await match("塑膠原料採購", { unit: "kg" });
    expect(names(m)).toEqual(expect.arrayContaining(["聚丙烯(PP)", "線性低密度聚乙烯(LLDPE)", "再生料-廢容器-PET廢塑膠片"]));
    expect(m.requires_confirmation).toBe(true);
    expect(m.candidates.filter((c) => c.factor.name === "聚丙烯(PP)").map((c) => c.factor.value).sort()).toEqual(["1.95", "2.01"]);
    expect(m.questions_to_resolve.join()).toContain("哪一種品項");
    expect(m.candidates[0].matched_by).toContain("非官方");
  });

  it("never returns a factor whose official name lacks the mapped word", async () => {
    const m = await match("塑膠原料", { limit: 25 });
    const words = CONCEPTS.find((c) => c.id === "plastic")!.selectors.map((s) => s.keyword!.toLowerCase());
    for (const n of names(m)) expect(words.some((w) => n.toLowerCase().includes(w)), n).toBe(true);
  });
});

describe("ledger-style descriptions", () => {
  it("maps an electricity bill to the three 2025 factors and asks for the tariff class", async () => {
    const m = await match("10 月電費", { unit: "度", year: 2025 });
    const official = m.candidates.filter((c) => c.factor.category === "electricity");
    expect(official.map((c) => c.factor.value).sort()).toEqual(["0.466", "0.467", "0.471"]);
    expect(official.every((c) => c.unit_fit === "compatible")).toBe(true);
    expect(m.questions_to_resolve.join()).toContain("電價種類");
    expect(m.candidates[0].factor.category).toBe("electricity");
  });

  it("without a year shows only the latest year, lists the others, and asks which year", async () => {
    const m = await match("電費", { limit: 25 });
    const years = new Set(m.candidates.filter((c) => c.factor.category === "electricity").map((c) => c.factor.reference_year));
    expect([...years]).toEqual([2025]);
    expect(m.available_years?.["moea-electricity"]?.length).toBe(21);
    expect(m.questions_to_resolve.join()).toContain("哪一年");
  });

  it("maps 水電費 to both electricity and water and keeps the two water utilities apart", async () => {
    const m = await match("水電費", { year: 2025, limit: 25 });
    expect(new Set(m.candidates.map((c) => c.factor.category))).toEqual(new Set(["electricity", "water", "product_footprint"]));
    expect(m.questions_to_resolve.join()).toContain("供水單位");
  });

  it("maps fleet fuel in litres to combustion factors that need a heating value and to the per-litre footprint", async () => {
    const m = await match("公務車加油", { unit: "公升", limit: 25 });
    const byFit = Object.fromEntries(m.candidates.map((c) => [c.factor.name, c.unit_fit]));
    expect(byFit["車用汽油(於移動源使用，2020)"]).toBe("compatible");
    expect(byFit["車用汽油（固定燃燒）"]).toBe("needs_heating_value");
    const q = m.questions_to_resolve.join();
    expect(q).toContain("低位熱值");
    expect(q).toContain("固定設備");
    expect(q).toContain("組織溫室氣體盤查");
  });
});

describe("which candidates are shown when there are more than the limit", () => {
  it("shows every kind of factor, so the official combustion factors are not crowded out by footprints", async () => {
    const m = await match("公務車加油", { unit: "公升", limit: 3 });
    expect(new Set(m.candidates.map((c) => c.factor.factor_type))).toEqual(new Set(["product_carbon_footprint", "stationary_combustion", "mobile_combustion"]));
    expect(m.total_candidates).toBeGreaterThan(3);
  });

  it("asks the questions raised by all candidates, not only the ones shown", async () => {
    const m = await match("公務車加油", { unit: "公升", limit: 1 });
    expect(m.questions_to_resolve.join()).toContain("低位熱值");
  });
});

describe("unit fit", () => {
  it("ranks usable candidates first and still shows why the others are not usable", async () => {
    const m = await match("影印紙", { unit: "kg" });
    expect(m.candidates.map((c) => [c.factor.unit, c.unit_fit])).toEqual([["公斤(kg)", "compatible"], ["包", "lookup_only"]]);
    expect(m.candidates[1].next_step).toContain("不能用本服務計算");
  });

  it("marks a per-kWh factor incompatible with litres and convertible from MWh", async () => {
    const litres = await match("電費", { unit: "L", year: 2025 });
    expect(litres.candidates.every((c) => c.unit_fit === "incompatible")).toBe(true);
    const mwh = await match("電費", { unit: "MWh", year: 2025 });
    expect(mwh.candidates[0].unit_fit).toBe("convertible");
  });

  it("gives a next step that names the factor ID to calculate with", async () => {
    const m = await match("電費", { unit: "kWh", year: 2025 });
    expect(m.candidates[0].next_step).toContain(m.candidates[0].factor.id);
  });
});

describe("specific versus general wording", () => {
  it("returns only the named item when the description names one", async () => {
    expect(names(await match("影印紙"))).toEqual(["原生木漿影印紙", "原生木漿影印紙"]);
  });

  it("expands a general word to the whole family", async () => {
    expect(names(await match("紙張採購", { limit: 25 }))).toEqual(expect.arrayContaining(["原生木漿影印紙", "抽取式衛生紙"]));
  });
});

describe("no match", () => {
  it("says so instead of offering something unrelated", async () => {
    const r = await matchActivity(db, { description: "員工旅遊住宿" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("no_candidates");
  });

  it("says the data is not loaded on an empty database", async () => {
    const r = await matchActivity(createTestDb(), { description: "電費" });
    if (r.ok) throw new Error("expected a failure");
    expect(r.error.code).toBe("data_not_loaded");
  });
});

describe("term table", () => {
  it("has unique concept IDs and no empty terms or selectors", () => {
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(CONCEPTS.length);
    for (const c of CONCEPTS) expect(c.terms.length > 0 && c.selectors.length > 0, c.id).toBe(true);
  });

  it("suggests nothing for a query that already names an official word or matches no concept", () => {
    expect(relatedTerms("聚丙烯")).toEqual([]);
    expect(relatedTerms("員工旅遊")).toEqual([]);
  });
});

/**
 * 服務層：MCP 工具與 REST API 共用的唯一一套查詢與計算邏輯。
 * 每個函式拿 D1 與參數，回傳可直接序列化的物件；失敗回 { ok: false, error }。
 */
import Big from "big.js";

import pkg from "../package.json";
import {
  calculate, compare, DISCLAIMER, interpret, parseDecimal, totalOf, type CalcError, type CalcInput, type CalcResult, type Comparison,
} from "./engine";
import {
  availableYears, documentsFor, electricityFactors, getFactor, getFactorVersion, latestJobs, listSources,
  listVersions, MAX_LIMIT, searchFactors, type SearchParams,
} from "./store";
import type { StoredFactor } from "./types";
import { supportedUnits } from "./units";
import { relatedTerms } from "./concepts";

export const SERVICE_NAME = "taiwan-carbon-open-data";
export const VERSION: string = pkg.version;

export const NOT_FOUND_MESSAGE = "目前沒有找到符合條件且已驗證的官方排放係數。";

/** 政府資料開放授權條款要求的顯名。 */
export const ATTRIBUTION =
  "資料來源：經濟部能源署、環境部、台灣自來水公司、臺北自來水事業處等機關公開資料。標示政府資料開放授權條款－第1版者，依該條款（https://data.gov.tw/license）授權利用；本服務為非官方整理。";

export type Failure = CalcError;
export const fail = (code: string, message: string, details?: Record<string, unknown>): Failure =>
  ({ ok: false, error: { code, message, ...(details ? { details } : {}) } }) as Failure;

/**
 * 資料庫是空的（剛部署、排程還沒跑過第一次同步）時，「查不到」的原因是本服務沒有資料，
 * 不是官方沒有公布。兩者對使用者的意義完全不同，所以查不到東西時先分辨是哪一種。
 * 只在已經查不到的路徑上呼叫，正常查詢不會多這一次查詢。
 */
export async function notLoaded(db: D1Database): Promise<Failure | null> {
  const any = await db.prepare("SELECT 1 AS x FROM emission_factors LIMIT 1").first();
  if (any) return null;
  return fail(
    "data_not_loaded",
    "本服務的資料尚未載入，暫時無法查詢或計算。這不代表官方沒有公布這項係數。請稍後再試，並請勿以其他來源的數值代替本服務的回答。",
  );
}

/** 資料分三層：government_data 是官方原文，service_curated 是本服務整理的欄位，計算結果另由引擎產生。 */
export function summary(f: StoredFactor) {
  return {
    id: f.id,
    name: f.name,
    value: f.value,
    components: f.components,
    unit: f.original_unit,
    normalized_unit: f.denominator_unit ? `${f.numerator_unit}${f.gas_basis}/${f.denominator_unit}` : null,
    reference_year: f.reference_year,
    announcement_year: f.announcement_year,
    announcement_date: f.announcement_date,
    category: f.category,
    factor_type: f.factor_type,
    variant: f.variant,
    scope: f.scope,
    calculability: f.calculability,
    source_id: f.source_id,
    source_url: f.source_url,
    version: f.version,
  };
}

export function ping(now: Date) {
  return { status: "ok", service: SERVICE_NAME, version: VERSION, server_time: now.toISOString() };
}

export async function listDataSources(db: D1Database) {
  const sources = await listSources(db);
  return { sources, attribution: ATTRIBUTION, disclaimer: DISCLAIMER };
}

export async function search(db: D1Database, params: Partial<SearchParams>) {
  const p: SearchParams = { ...params, limit: params.limit ?? 10, offset: params.offset ?? 0 };
  const { total, items } = await searchFactors(db, p);
  const related = p.query ? relatedTerms(p.query) : [];
  if (total === 0) {
    const empty = await notLoaded(db);
    if (empty) return empty;
  }
  return {
    total,
    limit: Math.min(Math.max(1, p.limit), MAX_LIMIT),
    offset: Math.max(0, p.offset),
    factors: items.map(summary),
    ...(related.length
      ? { related_terms: related, related_terms_note: "本服務整理的相關用詞（非官方對照）：搜尋只比對官方的係數名稱，可改用這些字再查，或用 match_activity 直接取得候選係數。" }
      : {}),
    ...(total === 0
      ? { message: NOT_FOUND_MESSAGE, hint: "搜尋比對的是官方的係數名稱，請試試更具體或不同的用詞（例如「塑膠原料」改查「聚丙烯」「聚乙烯」）。可用 list_data_sources 查看各來源的狀態與筆數。" }
      : {}),
    attribution: ATTRIBUTION,
  };
}

function calculabilityText(f: StoredFactor): { directly_calculable: boolean; explanation: string } {
  switch (f.calculability) {
    case "direct":
      return { directly_calculable: true, explanation: "活動數據乘以係數即可計算。" };
    case "needs_heating_value":
      return { directly_calculable: false, explanation: "需要使用者提供低位熱值才能計算；官方沒有公布預設熱值。" };
    case "lookup_only":
      return { directly_calculable: false, explanation: "僅供查詢：單位或計算邊界不足以安全地直接計算。" };
    default:
      return { directly_calculable: false, explanation: "來源尚未驗證，不可用於計算。" };
  }
}

export async function factorDetail(db: D1Database, id: string, version?: number) {
  const f = version === undefined ? await getFactor(db, id) : await getFactorVersion(db, id, version);
  if (!f) return (await notLoaded(db)) ?? fail("factor_not_found", NOT_FOUND_MESSAGE, { factor_id: id, ...(version !== undefined ? { version } : {}) });
  const documents = await documentsFor(db, f.source_id);
  const document = documents.find((d) => d.id === f.document_id) ?? null;
  return {
    ok: true as const,
    factor: {
      id: f.id,
      version: f.version,
      retrieved_at: f.retrieved_at,
      government_data: {
        name: f.name,
        value: f.value,
        components: f.components,
        unit: f.original_unit,
        reference_year: f.reference_year,
        announcement_year: f.announcement_year,
        announcement_date: f.announcement_date,
        effective_from: f.effective_from,
        original_record: f.original,
        source_url: f.source_url,
        document,
      },
      service_curated: {
        name_en: f.name_en,
        aliases: f.aliases,
        category: f.category,
        factor_type: f.factor_type,
        variant: f.variant,
        gas_basis: f.gas_basis,
        normalized_unit: f.denominator_unit ? `${f.numerator_unit}${f.gas_basis}/${f.denominator_unit}` : null,
        scope: f.scope,
        lifecycle_boundary: f.lifecycle_boundary,
        boundary_basis: f.boundary_basis,
        methodology: f.methodology,
        gwp_version: f.gwp_version,
        ...calculabilityText(f),
        usage_limits: f.usage_notes,
      },
    },
    attribution: ATTRIBUTION,
    disclaimer: DISCLAIMER,
  };
}

export const USAGE_TYPES = ["utility_average", "industry_inventory", "residential_tariff"] as const;
export type UsageType = (typeof USAGE_TYPES)[number];

/**
 * 指定年度的電力排碳係數。
 * - 該年度沒有資料：回錯誤並列出可用年度，不拿別的年度代替。
 * - 該年度官方只公布一個數值（113 年度以前）：回那一個，並說明沒有依用途劃分。
 * - 該年度有劃分（114 年度起）且沒指定用途：三個都回，由使用者依電價種類選。
 */
export async function electricity(db: D1Database, year: number, usageType?: UsageType) {
  const factors = await electricityFactors(db, year);
  if (factors.length === 0) {
    const empty = await notLoaded(db);
    if (empty) return empty;
    const years = await availableYears(db, { source_id: "moea-electricity", category: "electricity", variant: null });
    return fail(
      "no_factor_for_year",
      `${NOT_FOUND_MESSAGE}經濟部能源署尚未公布（或本服務尚未收錄）${year} 年度的電力排碳係數。不會以其他年度代替。`,
      { requested_year: year, available_years: years },
    );
  }
  const split = factors.some((f) => f.variant !== "single");
  const base = { ok: true as const, year, split_by_usage: split, attribution: ATTRIBUTION };

  if (!split) {
    return {
      ...base,
      factors: factors.map(summary),
      notice: usageType
        ? `${year} 年度官方只公布一個電力排碳係數，沒有依用途劃分；以下就是該年度的係數，適用於所有購買公用售電業電力的情形。`
        : `${year} 年度官方只公布一個電力排碳係數。`,
    };
  }
  if (!usageType) {
    return {
      ...base,
      factors: factors.map(summary),
      notice:
        "這個年度官方公布了三個數值，請依電價種類選擇：組織盤查用 industry_inventory（表燈營業、低壓、高壓、特高壓電力用戶）；表燈非營業與包燈用戶用 residential_tariff；utility_average 是公用售電業整體平均，供電業管制機關管理使用。本服務不會代為選擇。",
    };
  }
  const match = factors.filter((f) => f.variant === usageType);
  if (match.length === 0) return fail("no_factor_for_year", NOT_FOUND_MESSAGE, { requested_year: year, usage_type: usageType });
  return { ...base, factors: match.map(summary), usage_notes: match[0].usage_notes };
}

export interface CalcRequest extends CalcInput {
  factor_id: string;
  /** 用指定版本的係數重現過去的計算。不給就是目前版本。 */
  factor_version?: number;
}

export async function calculateOne(db: D1Database, req: CalcRequest, now: Date): Promise<CalcResult | Failure> {
  const factor = req.factor_version === undefined ? await getFactor(db, req.factor_id) : await getFactorVersion(db, req.factor_id, req.factor_version);
  if (!factor) return (await notLoaded(db)) ?? fail("factor_not_found", `${NOT_FOUND_MESSAGE}找不到係數 ${req.factor_id}。請先用 search_emission_factors 查詢係數 ID。`, { factor_id: req.factor_id });
  const years = req.year !== undefined && factor.reference_year !== null && factor.reference_year !== req.year ? await availableYears(db, factor) : [];
  return calculate(factor, req, now, years);
}

export interface BlendComponent {
  /** 成分的係數 ID，必須是公告附表四的含氟氣體。 */
  factor_id: string;
  /** 質量百分比。所有成分合計必須剛好是 100。 */
  mass_percent: string | number;
}

export type BlendRequest = Omit<CalcRequest, "factor_id"> & { components: BlendComponent[] };

export const MAX_BLEND_COMPONENTS = 6;

/**
 * 混合冷媒：依使用者提供的成分比例，把數量拆給各成分，逐一用該成分的官方 GWP 計算。
 * 本服務不內建任何冷媒的成分比例，比例完全來自使用者；合計不是 100 就拒絕，不補足也不調整。
 * 每個成分都走單一冷媒的計算路徑，所以每一筆都追溯得到官方係數與版本。
 */
export async function computeBlend(db: D1Database, req: BlendRequest, now: Date): Promise<{ ok: true; parts: { mass_percent: string; result: CalcResult }[] } | Failure> {
  // 一個版本號對不上多個成分各自的版本歷史；與其默默用目前版本，不如明說不支援。
  if (req.factor_version !== undefined) {
    return fail("invalid_request", "混合冷媒不支援 factor_version：各成分的版本歷史各自獨立，一個版本號無法對應。要重現過去的計算，請改用 factor_id 逐一計算各成分，並各自指定版本。");
  }
  const parts = req.components.map((c) => ({ id: c.factor_id, pct: parseDecimal(c.mass_percent) }));
  if (parts.length < 2 || parts.length > MAX_BLEND_COMPONENTS) {
    return fail("invalid_composition", `混合冷媒需要 2 到 ${MAX_BLEND_COMPONENTS} 個成分。單一冷媒請直接用 factor_id 計算。`);
  }
  if (parts.some((p) => !p.pct || p.pct.lte(0))) return fail("invalid_composition", "每個成分的質量百分比必須是大於 0 的數字。");
  if (new Set(parts.map((p) => p.id)).size !== parts.length) return fail("invalid_composition", "成分重複：同一個係數 ID 出現不只一次。");
  const sum = parts.reduce((s, p) => s.plus(p.pct!), new Big(0));
  if (!sum.eq(100)) {
    return fail("invalid_composition", `成分的質量百分比合計必須剛好是 100，目前是 ${sum.toFixed()}。本服務不會自行補足或調整比例，請確認成分後再試。`, { sum_percent: sum.toFixed() });
  }
  const quantity = parseDecimal(req.quantity);
  if (!quantity) return fail("invalid_quantity", "活動數據必須是不小於零的十進位數字。");

  const out: { mass_percent: string; result: CalcResult }[] = [];
  for (const p of parts) {
    const factor = await getFactor(db, p.id);
    if (!factor) return (await notLoaded(db)) ?? fail("factor_not_found", `${NOT_FOUND_MESSAGE}找不到成分的係數 ${p.id}。`, { factor_id: p.id });
    if (factor.factor_type !== "fugitive_emission") {
      return fail("invalid_composition", `成分必須是環境部公告附表四的含氟氣體；${p.id} 不是。表內沒有的成分（例如 R-22、碳氫冷媒）本服務無法計算。`, { factor_id: p.id });
    }
    const result = calculate(factor, { ...req, quantity: quantity.times(p.pct!).times("0.01").toFixed() }, now);
    if (!result.ok) return result;
    out.push({ mass_percent: p.pct!.toFixed(), result });
  }
  return { ok: true, parts: out };
}

type BlendPart = { mass_percent: string; result: CalcResult };

/** 對外呈現的混合冷媒結果：成分各自的官方係數加上加總。不再查資料庫，只整理形狀。 */
function presentBlend(req: Pick<BlendRequest, "quantity">, parts: BlendPart[], now: Date) {
  const kg = parts.reduce((s, p) => s.plus(p.result.emissions_kg), new Big(0));
  const weightedGwp = parts.reduce((s, p) => s.plus(new Big(p.mass_percent).times(p.result.factor.value!).times("0.01")), new Big(0));
  const first = parts[0].result;
  return {
    ok: true as const,
    kind: "refrigerant_blend" as const,
    activity: { quantity: parseDecimal(req.quantity)!.toFixed(), unit: first.activity.unit },
    composition: parts.map((p) => ({
      factor_id: p.result.factor.id,
      factor_version: p.result.factor.version,
      name: p.result.factor.name,
      mass_percent: p.mass_percent,
      gwp: p.result.factor.value,
      leaked_kg: p.result.activity.converted_quantity,
      emissions_kg: p.result.emissions_kg,
      source_url: p.result.factor.source_url,
    })),
    weighted_gwp: weightedGwp.toFixed(),
    weighted_gwp_note: "依使用者提供的成分比例與官方附表四的 GWP 計算而得，不是官方公布的數值。",
    formula: `${parts.map((p) => `${p.result.activity.converted_quantity} kg × ${p.result.factor.value}`).join(" + ")} = ${kg.toFixed()} kgCO2e`,
    emissions_kg: kg.toFixed(),
    emissions_t: kg.times("0.001").toFixed(),
    emissions_gas_basis: "CO2e",
    user_supplied: {
      composition: {
        components: parts.map((p) => ({ factor_id: p.result.factor.id, mass_percent: p.mass_percent })),
        note: "成分比例由使用者提供，本服務沒有內建任何冷媒的成分，也沒有查證這個比例；結果的正確性取決於它。",
      },
      ...first.user_supplied,
    },
    calculated_at: now.toISOString(),
    limitations: [
      "計算假設逸散的成分比例與填充時相同。",
      ...first.limitations.filter((l) => !l.includes("混合冷媒")),
    ],
    attribution: ATTRIBUTION,
    disclaimer: DISCLAIMER,
  };
}

export async function calculateBlend(db: D1Database, req: BlendRequest, now: Date) {
  const blend = await computeBlend(db, req, now);
  return blend.ok ? presentBlend(req, blend.parts, now) : blend;
}

/** 單一係數（factor_id）或混合冷媒（blend），兩者擇一。 */
export type ActivityRequest = Partial<CalcRequest> & Omit<CalcRequest, "factor_id"> & { blend?: BlendComponent[] };

/**
 * 一筆活動算完的結果：單一係數是一個 CalcResult，混合冷媒是各成分的 CalcResult。
 * 合計與比較都從這個形狀出發，混合冷媒因此只查詢、計算一次。
 */
export type Computed =
  | { kind: "single"; request: CalcRequest; result: CalcResult }
  | { kind: "blend"; request: BlendRequest; parts: BlendPart[] };

export async function computeActivity(db: D1Database, req: ActivityRequest, now: Date): Promise<Computed | Failure> {
  if (req.factor_id && req.blend) return fail("invalid_request", "factor_id 與 refrigerant_blend 只能給一個。");
  if (req.blend) {
    const request = { ...req, components: req.blend };
    const blend = await computeBlend(db, request, now);
    return blend.ok ? { kind: "blend", request, parts: blend.parts } : blend;
  }
  if (!req.factor_id) return fail("invalid_request", "請提供 factor_id；混合冷媒則提供 refrigerant_blend。");
  const request = { ...req, factor_id: req.factor_id };
  const result = await calculateOne(db, request, now);
  return result.ok ? { kind: "single", request, result } : result;
}

const isComputed = (c: Computed | Failure): c is Computed => "kind" in c;

/** 對外的結果：單一係數維持 CalcResult，混合冷媒用 calculateBlend 的形狀。 */
const present = (c: Computed, now: Date) => (c.kind === "single" ? c.result : presentBlend(c.request, c.parts, now));

const resultsOf = (c: Computed) => (c.kind === "single" ? [c.result] : c.parts.map((p) => p.result));

/** calculate_emissions 的入口：單一係數或混合冷媒，兩者擇一。 */
export async function calculateAny(db: D1Database, req: ActivityRequest, now: Date) {
  const c = await computeActivity(db, req, now);
  return isComputed(c) ? present(c, now) : c;
}

export const MAX_BATCH = 50;

export async function calculateBatch(db: D1Database, items: ActivityRequest[], now: Date) {
  const computed: (Computed | Failure)[] = [];
  for (const item of items.slice(0, MAX_BATCH)) computed.push(await computeActivity(db, item, now));
  return {
    results: computed.map((c, i) => ({ index: i, factor_id: items[i].factor_id, ...(isComputed(c) ? present(c, now) : c) })),
    total: totalOf(computed.flatMap((c): (CalcResult | CalcError)[] => (isComputed(c) ? resultsOf(c) : [c]))),
    attribution: ATTRIBUTION,
    disclaimer: DISCLAIMER,
  };
}

const kgOf = (c: Computed) => (c.kind === "single" ? c.result.emissions_kg : resultsOf(c).reduce((s, r) => s.plus(r.emissions_kg), new Big(0)).toFixed());

/** 比例用 Big 比較，"50.0" 與 50 視為相同；成分的順序不影響。 */
function pairBlendParts(a: BlendPart[], b: BlendPart[]): [BlendPart, BlendPart][] | null {
  if (a.length !== b.length) return null;
  const pairs: [BlendPart, BlendPart][] = [];
  for (const pa of a) {
    const pb = b.find((p) => p.result.factor.id === pa.result.factor.id);
    if (!pb || !new Big(pa.mass_percent).eq(pb.mass_percent)) return null;
    pairs.push([pa, pb]);
  }
  return pairs;
}

/**
 * 混合冷媒沒有官方公布的單一係數，加權 GWP 是用使用者的比例算出來的，不能當係數拆解。
 * 所以只有成分完全相同時，才逐成分比較再把拆解加總；其餘只回差額。
 */
const gasBasisOf = (c: Computed) => (c.kind === "single" ? c.result.emissions_gas_basis : "CO2e");

function compareComputed(a: Computed, b: Computed): Comparison {
  if (a.kind === "single" && b.kind === "single") return compare(a.result, b.result);

  const pairs = a.kind === "blend" && b.kind === "blend" ? pairBlendParts(a.parts, b.parts) : null;
  if (!pairs) {
    const reason =
      a.kind === "blend" && b.kind === "blend"
        ? "兩邊的混合冷媒成分不同（成分或比例不一樣）。"
        : "一邊是單一係數，一邊是混合冷媒。";
    const reasons = [
      ...(gasBasisOf(a) !== gasBasisOf(b) ? ["氣體基礎不同（CO2 與 CO2e）。"] : []),
      `${reason}混合冷媒沒有官方公布的單一係數，加權 GWP 是依使用者提供的比例算出來的，所以不拆解活動量與係數的影響，只回差額。`,
    ];
    return {
      baseline_emissions_kg: kgOf(a),
      comparison_emissions_kg: kgOf(b),
      difference_kg: new Big(kgOf(b)).minus(kgOf(a)).toFixed(),
      method_changed: true,
      method_change_reasons: reasons,
      decomposition: null,
      interpretation: interpret(true, null),
    };
  }

  const each = pairs.map(([pa, pb]) => compare(pa.result, pb.result));
  const reasons = [...new Set(each.flatMap((c) => c.method_change_reasons))];
  const decomposed = each.every((c) => c.decomposition);
  const decomposition = decomposed
    ? {
        activity_effect_kg: each.reduce((s, c) => s.plus(c.decomposition!.activity_effect_kg), new Big(0)).toFixed(),
        factor_effect_kg: each.reduce((s, c) => s.plus(c.decomposition!.factor_effect_kg), new Big(0)).toFixed(),
        explanation: `${each[0].decomposition!.explanation}混合冷媒的成分相同，所以逐成分拆解後加總。`,
      }
    : null;
  return {
    baseline_emissions_kg: kgOf(a),
    comparison_emissions_kg: kgOf(b),
    difference_kg: new Big(kgOf(b)).minus(kgOf(a)).toFixed(),
    method_changed: reasons.length > 0,
    method_change_reasons: reasons,
    decomposition,
    interpretation: interpret(reasons.length > 0, decomposition),
  };
}

export async function compareEmissions(db: D1Database, baseline: ActivityRequest, comparison: ActivityRequest, now: Date) {
  const a = await computeActivity(db, baseline, now);
  const b = await computeActivity(db, comparison, now);
  if (!isComputed(a) || !isComputed(b)) {
    return fail("comparison_failed", "有一邊算不出來，無法比較。", { baseline: isComputed(a) ? "ok" : a.error, comparison: isComputed(b) ? "ok" : b.error });
  }
  return { ok: true as const, baseline: present(a, now), comparison: present(b, now), result: compareComputed(a, b), disclaimer: DISCLAIMER };
}

export async function factorVersions(db: D1Database, id: string) {
  const versions = await listVersions(db, id);
  if (versions.length === 0) return (await notLoaded(db)) ?? fail("factor_not_found", NOT_FOUND_MESSAGE, { factor_id: id });
  return { ok: true as const, factor_id: id, versions };
}

/** 各來源的同步狀態。只讀；公開端沒有任何觸發同步或寫入的途徑。 */
export async function updateStatus(db: D1Database) {
  const [sources, jobs] = await Promise.all([listSources(db), latestJobs(db)]);
  return {
    sources: sources.map((s) => ({
      id: s.id,
      dataset_name: s.dataset_name,
      status: s.status,
      health: s.health,
      health_note: s.health_note,
      ingestion: s.ingestion,
      last_checked_at: s.last_checked_at,
      last_success_at: s.last_success_at,
      factor_count: s.factor_count,
      latest_jobs: jobs.filter((j) => j.source_id === s.id),
    })),
    note: "這裡只能查詢同步狀態。資料同步由排程執行，人工審核的資料經版本控管審查後才會進入資料庫；公開端無法觸發寫入。",
  };
}

const METHODOLOGY = {
  overview: {
    title: "計算方法總覽",
    body: [
      "基本公式：排放量 = 活動數據 × 排放係數。",
      "所有係數都來自資料庫中已查證的官方資料；查不到就回報查不到，不會估算或補齊。",
      "數值以精確十進位運算，回傳精確乘積，不另外四捨五入；來源係數的有效位數另以 significant_figures 回報，引用結果時請自行依有效位數取捨。",
      "使用者指定活動年度時，只使用該年度適用的係數；找不到不會自動以其他年度代替。",
      "「公告年份」與「適用年度」是兩回事：電力排碳係數通常在適用年度的次年公告。",
    ],
  },
  electricity: {
    title: "購入電力",
    body: [
      "來源：經濟部能源署歷年電力排碳係數公告（PDF）。",
      "94 至 113 年度（2005–2024）每年公布一個數值。",
      "114 年度（2025）起公布三個數值：公用售電業 0.467（供電業管制機關管理使用）、產業盤查使用 0.466（表燈營業、低壓、高壓、特高壓電力用戶）、表燈非營業與包燈用戶 0.471。",
      "只適用於購買公用售電業電力；直供、轉供的再生能源與非公用售電業電力應使用供應商提供的係數。",
    ],
  },
  fuel_combustion: {
    title: "燃料燃燒（固定與移動）",
    body: [
      "來源：環境部 113 年 2 月 5 日公告「溫室氣體排放係數」（環部授氣字第1139101231號）附表一。",
      "生質燃料：燃燒產生的 CO2 需計算並單獨表列（biogenic_co2_kg），不計入排放總量；CH4 與 N2O 計入總量。",
      "係數以低位熱值為基礎，單位 kg/TJ，CO2、CH4、N2O 分別提供。",
      "公式：排放量 = 活動數據 × 低位熱值 × 4.1868×10⁻⁹ TJ/kcal × 排放係數 × 溫暖化潛勢。",
      "溫暖化潛勢採公告附表四（IPCC AR5）：CO2 1、CH4 28、N2O 265。",
      "官方不提供預設熱值，也不提供每公升係數；低位熱值必須由使用者提供（自行檢測或供應商提供）。本服務不會假設熱值，也不會用密度把公升換成公斤。",
      "不可用產品碳足跡係數取代燃燒排放係數。",
    ],
  },
  water: {
    title: "自來水",
    body: [
      "台灣自來水公司與臺北自來水事業處各自公布每度水的排放量，服務區域與計算邊界不同，不可混用。",
      "台灣自來水公司公布的單位是 CO2（用電與用油），臺北自來水事業處是 CO2e（類別1＋類別2）；兩者不可相加。",
    ],
  },
  refrigerant: {
    title: "冷媒等含氟氣體的逸散",
    body: [
      "來源：環境部 113 年 2 月 5 日公告附表四的溫暖化潛勢（IPCC AR5），以及附表三「冷凍及空調」的設備逸散率範圍。",
      "公式：排放量 = 逸散量 × 溫暖化潛勢。以設備填充量估算時，逸散量 = 填充量 × 年逸散率。",
      "官方附表三只提供各類設備逸散率的範圍（例如住宅及商業建築空調每年 1% 至 10%），沒有單一預設值。年逸散率必須由使用者提供，本服務只會指出它是否落在官方範圍內。",
      "計算時必須說明數量是實際逸散（補充）量還是設備填充量；本服務不會假設，因為把填充量當成逸散量會嚴重高估。",
      "附表四只列純物質。混合冷媒（R-410A、R-407C 等）可用 refrigerant_blend 計算：由使用者提供各成分的質量百分比，本服務依附表四逐成分計算並加總。本服務沒有內建任何冷媒的成分比例，也不查證使用者給的比例。",
      "R-22 與碳氫冷媒不在附表四內，無法計算。",
    ],
  },
  product_footprint: {
    title: "產品碳足跡係數",
    body: [
      "來源：環境部碳足跡排放係數資料集（CFP_P_02），透過 API 同步。",
      "以包、瓶、片等件數計的係數，以及官方資料中名稱、單位、發布單位、公告年份都相同而數值不同的紀錄，僅供查詢，不提供計算。",
      "這類係數是產品生命週期碳足跡，不代表可直接用於組織溫室氣體盤查，也不可與組織盤查的結果相加。",
      "每件產品的碳足跡不可當成每公斤材料的係數。",
    ],
  },
  units: {
    title: "單位",
    body: [
      `支援的單位：${supportedUnits().join("、")}。`,
      "只做同一量綱內的換算（kg 與 t、L 與公秉、kWh 與 MWh）。",
      "「度」在電是 kWh、在水是 m³，依所用係數決定。",
      "沒有密度資料時，不會把體積換成質量。",
    ],
  },
  limitations: {
    title: "限制與免責",
    body: [
      DISCLAIMER,
      "本服務由 taux.io 開發維運，不是政府官方網站，與資料提供機關無隸屬關係。",
      "回應中 government_data 是官方原始資料，service_curated 是本服務整理的分類與說明，計算結果則是本服務的運算。",
    ],
  },
} as const;

export type MethodologyTopic = keyof typeof METHODOLOGY;
export const METHODOLOGY_TOPICS = Object.keys(METHODOLOGY) as MethodologyTopic[];

export function methodology(topic?: MethodologyTopic) {
  return {
    topics: topic ? { [topic]: METHODOLOGY[topic] } : METHODOLOGY,
    official_references: [
      { title: "環境部 公告「溫室氣體排放係數」及盤查作業指引", url: "https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=1" },
      { title: "經濟部能源署 電力排碳係數", url: "https://www.moeaea.gov.tw/ecw/populace/content/ContentDesc.aspx?menu_id=27028" },
      { title: "政府資料開放授權條款－第1版", url: "https://data.gov.tw/license" },
    ],
    attribution: ATTRIBUTION,
  };
}

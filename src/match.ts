/**
 * 科目對照：把一段活動描述（「10 月電費」「塑膠原料 250 公斤」）對到候選係數。
 *
 * 這個函式只「找候選、說明條件」，不選定係數。同一個描述通常對得到好幾筆
 * （不同年度、不同用途、盤查用與產品碳足跡），選哪一筆取決於只有使用者知道的事，
 * 所以回應一律帶 requires_confirmation 與待確認的問題。
 */
import { conceptsIn, selectorsFor } from "./concepts";
import { DISCLAIMER } from "./engine";
import { ATTRIBUTION, fail, NOT_FOUND_MESSAGE, notLoaded, summary } from "./service";
import { findByNames, searchFactors } from "./store";
import type { StoredFactor } from "./types";
import { dimensionOf, resolveUnit, UnitError } from "./units";

export type UnitFit = "compatible" | "convertible" | "needs_heating_value" | "not_checked" | "lookup_only" | "incompatible";

/** 候選的排序：能直接用的在前，不能用的在後但仍然列出，讓使用者知道為什麼不能用。 */
const FIT_ORDER: UnitFit[] = ["compatible", "convertible", "needs_heating_value", "not_checked", "lookup_only", "incompatible"];

export const MAX_CANDIDATES = 25;
/** 每個概念最多取回這麼多筆再排序；「紙」「鋼」這類字在產品碳足跡裡有幾十筆。 */
const FETCH_LIMIT = 200;

function unitFit(f: StoredFactor, unit: string | undefined): { fit: UnitFit; note: string } {
  if (f.calculability === "lookup_only" || f.calculability === "pending") {
    return { fit: "lookup_only", note: `這筆係數僅供查詢、不提供計算（官方宣告單位：${f.original_unit}）。` };
  }
  if (!unit) return { fit: "not_checked", note: "未提供單位，尚未檢查單位是否相容。" };

  if (f.calculability === "needs_heating_value") {
    try {
      const dim = dimensionOf(resolveUnit(unit));
      if (dim === "volume" || dim === "mass") {
        return { fit: "needs_heating_value", note: "單位可用，但計算時必須另外提供燃料的低位熱值（kcal/L、kcal/kg 或 kcal/m3）。" };
      }
    } catch (e) {
      if (!(e instanceof UnitError)) throw e;
    }
    return { fit: "incompatible", note: `燃料燃燒係數需要以體積或質量計的活動數據，「${unit}」不適用。` };
  }

  const target = f.denominator_unit!;
  try {
    const resolved = resolveUnit(unit, target);
    if (resolved === target) return { fit: "compatible", note: `單位相符（${target}）。` };
    if (dimensionOf(resolved) === dimensionOf(target)) return { fit: "convertible", note: `單位可換算：${resolved} → ${target}。` };
  } catch (e) {
    if (!(e instanceof UnitError)) throw e;
  }
  return { fit: "incompatible", note: `單位不相容：係數以 ${target} 計，「${unit}」無法在沒有其他資料的情況下換算。` };
}

function nextStep(f: StoredFactor, fit: UnitFit): string {
  if (fit === "lookup_only") return "只能引用係數本身，不能用本服務計算。";
  if (fit === "incompatible") return "需要把活動數據改成係數的單位，或改選其他係數。";
  if (f.factor_type === "fugitive_emission") {
    return `確認冷媒種類後，以 factor_id「${f.id}」呼叫 calculate_emissions，並在 optional_context.refrigerant 說明數量是逸散量（leaked_amount）還是填充量（charge，需附 leak_rate_percent）。`;
  }
  if (f.calculability === "needs_heating_value") return `確認適用後，以 factor_id「${f.id}」呼叫 calculate_emissions，並在 optional_context.lower_heating_value 提供低位熱值。`;
  return `確認適用後，以 factor_id「${f.id}」呼叫 calculate_emissions。`;
}

/** 未指定年度時，同一來源的逐年係數只留最新年度，其餘年度以 available_years 告知。 */
function latestPerSource(factors: StoredFactor[]): { kept: StoredFactor[]; years: Record<string, number[]> } {
  const latest = new Map<string, number>();
  const years: Record<string, Set<number>> = {};
  for (const f of factors) {
    if (f.reference_year === null) continue;
    (years[f.source_id] ??= new Set()).add(f.reference_year);
    latest.set(f.source_id, Math.max(latest.get(f.source_id) ?? 0, f.reference_year));
  }
  return {
    kept: factors.filter((f) => f.reference_year === null || f.reference_year === latest.get(f.source_id)),
    years: Object.fromEntries(Object.entries(years).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
  };
}

function questionsFor(candidates: StoredFactor[], fits: UnitFit[], yearGiven: boolean): string[] {
  const q: string[] = [];
  const types = new Set(candidates.map((f) => f.factor_type));
  if (!yearGiven && candidates.some((f) => f.reference_year !== null)) {
    q.push("活動發生在哪一年？未指定年度，逐年公布的係數只列出最新年度；請確認年度後再計算。");
  }
  if (new Set(candidates.filter((f) => f.category === "electricity").map((f) => f.variant)).size > 1) {
    q.push("電價種類是什麼？表燈營業、低壓、高壓、特高壓電力用戶用產業盤查使用的係數；表燈非營業與包燈用戶另有係數。");
  }
  if (new Set(candidates.filter((f) => f.category === "water").map((f) => f.source_id)).size > 1) {
    q.push("供水單位是台灣自來水公司還是臺北自來水事業處？兩者的係數與計算邊界不同。");
  }
  if (types.has("stationary_combustion") && types.has("mobile_combustion")) {
    q.push("燃料用在固定設備（鍋爐、發電機）還是車輛？固定燃燒與移動燃燒的係數不同。");
  }
  if (types.has("fugitive_emission")) {
    q.push("用的是哪一種冷媒？數量是實際逸散（補充）量還是設備填充量？以填充量計算需要年逸散率，官方只提供各類設備的範圍。混合冷媒（如 R-410A）不在官方表內，要用 refrigerant_blend 計算（calculate_emissions、calculate_batch、compare_emissions、build_inventory 都接受），成分比例需由使用者提供，本服務沒有內建。");
  }
  if (fits.includes("needs_heating_value")) q.push("燃料的低位熱值是多少？官方沒有預設值，需自行檢測或向供應商取得。");
  if (types.has("product_carbon_footprint") && types.size > 1) {
    q.push("要算的是組織溫室氣體盤查的排放，還是產品生命週期的碳足跡？兩種係數的邊界不同，結果不可相加。");
  }
  if (candidates.filter((f) => f.factor_type === "product_carbon_footprint").length > 1) {
    q.push("實際採購或使用的是哪一種品項？名稱相近的產品碳足跡係數可能差異很大，請依品項與發布單位確認。");
  }
  return q;
}

/**
 * 各類型輪流取。產品碳足跡常有幾十筆單位相符的候選，照排序直接截斷會把組織盤查用的
 * 官方係數（例如需要熱值的燃燒係數）整個擠出畫面，而那往往才是使用者該看到的。
 */
function roundRobin<T>(items: T[], groupOf: (item: T) => string, limit: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(groupOf(item), [...(groups.get(groupOf(item)) ?? []), item]);
  const queues = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < Math.min(limit, items.length); i++) {
    for (const q of queues) if (q[i] !== undefined && out.length < limit) out.push(q[i]);
  }
  return out;
}

export interface MatchParams {
  description: string;
  unit?: string;
  year?: number;
  limit?: number;
}

export async function matchActivity(db: D1Database, p: MatchParams) {
  const concepts = conceptsIn(p.description);
  const found = new Map<string, { factor: StoredFactor; order: number; via: string }>();

  // 先看描述本身是否直接就是官方名稱裡的字（「聚丙烯 250 公斤」）。
  const direct = await searchFactors(db, { query: p.description, year: p.year, limit: 50, offset: 0 });
  for (const f of direct.items) found.set(f.id, { factor: f, order: -1, via: "名稱或別名直接符合" });

  for (const concept of concepts) {
    const selectors = selectorsFor(concept, p.description);
    const factors = await findByNames(db, selectors, p.year, FETCH_LIMIT);
    for (const f of factors) {
      if (found.has(f.id)) continue;
      const order = selectors.findIndex((s) => s.category === f.category && (!s.keyword || f.name.toLowerCase().includes(s.keyword.toLowerCase())));
      const keyword = selectors[order]?.keyword;
      found.set(f.id, {
        factor: f,
        order,
        via: keyword ? `本服務的用詞對照（非官方）：「${concept.label}」→ 名稱含「${keyword}」` : `本服務的用詞對照（非官方）：「${concept.label}」`,
      });
    }
  }

  if (found.size === 0) {
    return (
      (await notLoaded(db)) ??
      fail("no_candidates", `${NOT_FOUND_MESSAGE}這段描述對不到任何已收錄的係數。請改用更具體的品項名稱，或用 search_emission_factors 以關鍵字查詢。`, {
        description: p.description,
      })
    );
  }

  const all = [...found.values()];
  const { kept, years } = p.year === undefined ? latestPerSource(all.map((x) => x.factor)) : { kept: all.map((x) => x.factor), years: {} };
  const keptIds = new Set(kept.map((f) => f.id));

  const ranked = all
    .filter((x) => keptIds.has(x.factor.id))
    .map((x) => ({ ...x, ...unitFit(x.factor, p.unit) }))
    .sort((a, b) => FIT_ORDER.indexOf(a.fit) - FIT_ORDER.indexOf(b.fit) || a.order - b.order || a.factor.id.localeCompare(b.factor.id));

  const limit = Math.min(Math.max(1, p.limit ?? 10), MAX_CANDIDATES);
  const shown = roundRobin(ranked, (x) => x.factor.factor_type, limit);

  return {
    ok: true as const,
    description: p.description,
    unit: p.unit ?? null,
    year: p.year ?? null,
    requires_confirmation: true,
    guidance:
      "以下是候選係數，不是答案。本服務不會代為選定：請依「待確認事項」與每筆的適用條件，由使用者確認後再計算。對照關係是本服務整理的，不是官方資料。",
    matched_concepts: concepts.map((c) => c.label),
    questions_to_resolve: questionsFor(ranked.map((x) => x.factor), ranked.map((x) => x.fit), p.year !== undefined),
    total_candidates: ranked.length,
    candidates: shown.map((x) => ({
      factor: summary(x.factor),
      matched_by: x.via,
      unit_fit: x.fit,
      unit_note: x.note,
      applicability: { scope: x.factor.scope, boundary: x.factor.lifecycle_boundary, conditions: x.factor.usage_notes },
      next_step: nextStep(x.factor, x.fit),
    })),
    ...(Object.keys(years).length ? { available_years: years } : {}),
    attribution: ATTRIBUTION,
    disclaimer: DISCLAIMER,
  };
}

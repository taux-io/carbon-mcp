/**
 * 盤查清冊彙整：把多筆活動的計算結果依範疇一、二、三分類並小計。
 *
 * 計算仍由 calculateOne（也就是引擎）完成，這裡只做分類與加總。加總的規則比「全部加起來」保守：
 * - 氣體基礎不同（CO2 與 CO2e）不相加。
 * - 某個範疇有項目算不出來，那個範疇的小計就不給，因為會漏算。
 * - 範疇三含產品碳足跡時，不給跨範疇的總計：產品碳足跡是生命週期數值，
 *   可能已經包含燃燒或發電的排放，與範疇一、二相加會重複計算，而這裡無法判斷有沒有重疊。
 */
import Big from "big.js";

import { DISCLAIMER, type CalcResult } from "./engine";
import { ATTRIBUTION, calculateOne, computeBlend, fail, MAX_BATCH, type BlendComponent, type CalcRequest, type Failure } from "./service";
import { getFactor } from "./store";
import type { FactorType } from "./types";

export type Scope = 1 | 2 | 3;

/**
 * 係數類型 → 範疇。這是本服務依常見的盤查實務所做的預設分類，不是官方對個別項目的認定；
 * 實際歸屬取決於組織邊界（例如承租場所的用電），所以每筆項目都可以用 scope 覆寫。
 */
const SCOPE_OF: Record<FactorType, Scope> = {
  stationary_combustion: 1,
  mobile_combustion: 1,
  fugitive_emission: 1,
  purchased_electricity: 2,
  water_supply: 3,
  product_carbon_footprint: 3,
};

const SCOPE_INFO: Record<Scope, { name: string; iso_14064_1: string; description: string }> = {
  1: { name: "範疇一", iso_14064_1: "類別1", description: "直接排放：組織擁有或控制的排放源（固定燃燒、移動燃燒、冷媒等逸散）。" },
  2: { name: "範疇二", iso_14064_1: "類別2", description: "能源間接排放：外購電力、蒸汽等。" },
  3: { name: "範疇三", iso_14064_1: "類別3至6", description: "其他間接排放：上下游的運輸、採購的商品與服務（含自來水）等。" },
};

export interface InventoryItem extends Omit<CalcRequest, "factor_id"> {
  /** 單一係數。與 blend 擇一。 */
  factor_id?: string;
  /** 混合冷媒的成分。清冊中會展開成每個成分一行。 */
  blend?: BlendComponent[];
  /** 這筆活動的名稱，例如「總公司電費」。只用來讓清冊好讀。 */
  label?: string;
  /** 覆寫預設的範疇分類。 */
  scope?: Scope;
}

export interface Subtotal {
  available: boolean;
  emissions_kg?: string;
  emissions_t?: string;
  emissions_gas_basis?: string;
  item_count: number;
  withheld_reasons?: string[];
}

const plain = (n: Big) => n.toFixed();

function subtotal(results: CalcResult[], extraReasons: string[] = []): Subtotal {
  const reasons = [...extraReasons];
  if (new Set(results.map((r) => r.emissions_gas_basis)).size > 1) reasons.push("項目的氣體基礎不同（CO2 與 CO2e），不能相加。");
  if (reasons.length) return { available: false, item_count: results.length, withheld_reasons: reasons };
  if (results.length === 0) return { available: true, emissions_kg: "0", emissions_t: "0", emissions_gas_basis: "CO2e", item_count: 0 };
  const kg = results.reduce((sum, r) => sum.plus(r.emissions_kg), new Big(0));
  return { available: true, emissions_kg: plain(kg), emissions_t: plain(kg.times("0.001")), emissions_gas_basis: results[0].emissions_gas_basis, item_count: results.length };
}

/**
 * 範疇一依氣體分列（各自的 CO2e）。燃燒係數有 CO2、CH4、N2O 的明細；
 * 逸散的含氟氣體依公告附表四的類別（HFCs、PFCs 及其他全氟化物）歸類。
 * 有任何一筆分不出氣體就不給這張表，免得加起來與小計對不上。
 */
function byGas(results: CalcResult[]): Record<string, string> | null {
  if (results.length === 0) return null;
  const sums = new Map<string, Big>();
  const add = (gas: string, kg: string) => sums.set(gas, (sums.get(gas) ?? new Big(0)).plus(kg));
  for (const r of results) {
    if (r.breakdown) for (const b of r.breakdown) if (!b.excluded_from_total) add(b.gas, b.emissions_kg_co2e);
    if (!r.breakdown && r.factor.factor_type === "fugitive_emission" && r.factor.variant) add(r.factor.variant, r.emissions_kg);
    if (!r.breakdown && r.factor.factor_type !== "fugitive_emission") return null;
  }
  return Object.fromEntries([...sums].map(([gas, kg]) => [gas, plain(kg)]));
}

interface Entry {
  index: number;
  item: InventoryItem;
  result: CalcResult | Failure;
  scope: Scope | null;
  classifiedBy: "user" | "default" | null;
}

export async function buildInventory(db: D1Database, items: InventoryItem[], inventoryYear: number | undefined, now: Date) {
  const entries: Entry[] = [];
  for (const [index, item] of items.slice(0, MAX_BATCH).entries()) {
    const year = item.year ?? inventoryYear;
    const by = item.scope ? ("user" as const) : ("default" as const);
    if (item.blend && item.factor_id) {
      entries.push({ index, item, result: fail("invalid_request", "factor_id 與 refrigerant_blend 只能給一個。"), scope: item.scope ?? null, classifiedBy: null });
      continue;
    }
    if (item.blend) {
      const scope = item.scope ?? SCOPE_OF.fugitive_emission;
      const blend = await computeBlend(db, { ...item, year, components: item.blend }, now);
      if (!blend.ok) {
        entries.push({ index, item, result: blend, scope, classifiedBy: by });
        continue;
      }
      for (const part of blend.parts) {
        const label = `${item.label ?? "混合冷媒"}（成分 ${part.result.factor.name}，${part.mass_percent}%）`;
        entries.push({ index, item: { ...item, label }, result: part.result, scope, classifiedBy: by });
      }
      continue;
    }
    if (!item.factor_id) {
      entries.push({ index, item, result: fail("invalid_request", "請提供 factor_id；混合冷媒則提供 refrigerant_blend。"), scope: item.scope ?? null, classifiedBy: null });
      continue;
    }
    const result = await calculateOne(db, { ...item, factor_id: item.factor_id, year }, now);
    // 算不出來的項目也要知道它屬於哪個範疇，才能只扣住那個範疇的小計。
    const factorType = result.ok ? (result.factor.factor_type as FactorType) : (await getFactor(db, item.factor_id))?.factor_type;
    const scope = item.scope ?? (factorType ? SCOPE_OF[factorType] : null);
    entries.push({ index, item, result, scope, classifiedBy: item.scope ? "user" : scope ? "default" : null });
  }

  const failed = entries.filter((e) => !e.result.ok);
  const okOf = (scope: Scope) => entries.filter((e) => e.scope === scope && e.result.ok).map((e) => e.result as CalcResult);
  const failedIn = (scope: Scope) => failed.filter((e) => e.scope === scope).length;
  const unplaced = failed.filter((e) => e.scope === null).length;

  const scopes = ([1, 2, 3] as const).map((scope) => {
    const results = okOf(scope);
    const missing = failedIn(scope);
    const sub = subtotal(results, missing ? [`這個範疇有 ${missing} 筆項目算不出來，小計會漏算。`] : []);
    return {
      scope,
      ...SCOPE_INFO[scope],
      subtotal: sub,
      ...(scope === 1 && byGas(results) ? { by_gas_kg_co2e: byGas(results) } : {}),
      items: entries
        .filter((e) => e.scope === scope && e.result.ok)
        .map((e) => {
          const r = e.result as CalcResult;
          return {
            index: e.index,
            label: e.item.label ?? null,
            factor_id: r.factor.id,
            factor_version: r.factor.version,
            factor_name: r.factor.name,
            factor_type: r.factor.factor_type,
            classified_by: e.classifiedBy,
            activity: `${r.activity.quantity} ${r.activity.unit}`,
            emissions_kg: r.emissions_kg,
            emissions_t: r.emissions_t,
            emissions_gas_basis: r.emissions_gas_basis,
            reference_year: r.factor.reference_year,
            source_url: r.factor.source_url,
            ...(r.biogenic_co2_kg ? { biogenic_co2_kg: r.biogenic_co2_kg } : {}),
            ...(r.user_supplied ? { user_supplied: r.user_supplied } : {}),
          };
        }),
    };
  });

  const incomplete = unplaced ? [`有 ${unplaced} 筆項目找不到係數，無法歸入任何範疇。`] : [];
  const reasonsFor = (list: Scope[]) => [
    ...incomplete,
    ...list.filter((s) => failedIn(s) > 0).map((s) => `${SCOPE_INFO[s].name}有項目算不出來。`),
  ];

  const hasFootprint = okOf(3).some((r) => r.factor.factor_type === "product_carbon_footprint");
  const scope12 = subtotal([...okOf(1), ...okOf(2)], reasonsFor([1, 2]));
  const all = subtotal([...okOf(1), ...okOf(2), ...okOf(3)], [
    ...reasonsFor([1, 2, 3]),
    ...(hasFootprint
      ? ["範疇三含產品碳足跡係數。產品碳足跡是生命週期數值，可能已包含燃燒或發電的排放，與範疇一、二相加可能重複計算；請確認沒有重疊後自行加總。"]
      : []),
  ]);

  const warnings: string[] = [];
  const ids = entries.filter((e) => e.result.ok).map((e) => (e.result as CalcResult).factor.id);
  if (new Set(ids).size !== ids.length) warnings.push("同一筆係數被用了不只一次，請確認這些活動數據沒有重疊。");
  if (entries.some((e) => e.classifiedBy === "user")) warnings.push("有項目的範疇是使用者指定的，本服務未檢查其合理性。");
  const years = new Set(entries.filter((e) => e.result.ok).map((e) => (e.result as CalcResult).factor.reference_year).filter((y) => y !== null));
  if (years.size > 1) warnings.push(`清冊中的係數適用年度不一致（${[...years].sort().join("、")}），請確認是否為同一個盤查年度。`);

  return {
    ok: true as const,
    inventory_year: inventoryYear ?? null,
    generated_at: now.toISOString(),
    scopes,
    scope_1_and_2_total: scope12,
    total_all_scopes: all,
    failed_items: failed.map((e) => ({
      index: e.index,
      label: e.item.label ?? null,
      factor_id: e.item.factor_id ?? null,
      scope: e.scope,
      error: (e.result as Failure).error,
    })),
    completeness: (() => {
      const total = Math.min(items.length, MAX_BATCH);
      const failedItems = new Set(failed.map((e) => e.index)).size;
      return { items: total, calculated: total - failedItems, failed: failedItems };
    })(),
    classification_note:
      "範疇分類是本服務依係數類型做的預設（燃燒為範疇一、外購電力為範疇二、自來水與產品碳足跡為範疇三），不是官方對個別項目的認定。實際歸屬取決於組織邊界，可用每筆項目的 scope 覆寫。這份彙整只涵蓋你提供的活動，不代表盤查的完整性（例如製程排放、廢水與化糞池的排放本服務無法計算）。生質燃料的 CO2 依官方指引單獨表列於各項目的 biogenic_co2_kg，未計入小計。",
    warnings,
    attribution: ATTRIBUTION,
    disclaimer: DISCLAIMER,
  };
}

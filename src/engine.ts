/**
 * 計算引擎。純函式：不碰資料庫、不碰網路。MCP 工具與 REST API 都只呼叫這裡。
 *
 * 原則：
 * - 係數只來自呼叫端傳進來的 StoredFactor（也就是資料庫），這裡沒有任何寫死的係數。
 * - 算不了就回錯誤，說清楚缺什麼，不猜。
 * - 乘法用精確十進位，回傳精確乘積；不四捨五入，也不宣稱比來源更高的精度（有效位數另外回報）。
 */
import Big from "big.js";

import { GWP_AR5, REFRIGERATION_EQUIPMENT, TJ_PER_KCAL, type RefrigerationEquipment } from "./data/reviewed";
import type { Gas, StoredFactor } from "./types";
import { convert, resolveUnit, UnitError } from "./units";

export const DISCLAIMER =
  "非官方服務的計算結果，僅供參考；不構成碳盤查認證、第三方查證或法定合規保證。係數為政府公開資料，數值與適用範圍請以官方來源為準。";

export type CalcErrorCode =
  | "invalid_quantity"
  | "unknown_unit"
  | "ambiguous_unit"
  | "incompatible_unit"
  | "year_mismatch"
  | "factor_not_effective"
  | "not_calculable"
  | "missing_heating_value"
  | "invalid_heating_value"
  | "missing_refrigerant_basis"
  | "invalid_leak_rate"
  | "factor_not_found";

export interface CalcError {
  ok: false;
  error: { code: CalcErrorCode; message: string; details?: Record<string, unknown> };
}

export interface HeatingValue {
  /** 低位熱值，十進位字串或數字。 */
  value: string | number;
  /** 例如 "kcal/L"、"kcal/kg"、"kcal/m3"。 */
  unit: string;
}

export interface CalcInput {
  quantity: string | number;
  quantity_unit: string;
  /** 活動發生的年度。有給就必須與係數的適用年度相符。 */
  year?: number;
  context?: { lower_heating_value?: HeatingValue; refrigerant?: RefrigerantBasis };
}

export interface RefrigerantBasis {
  /** leaked_amount：數量就是逸散（補充）量。charge：數量是設備填充量，需另給年逸散率。 */
  basis: "leaked_amount" | "charge";
  /** 年逸散率（%）。basis 為 charge 時必填。 */
  leak_rate_percent?: string | number;
  /** 設備類型。有給就會附上官方附表三的逸散率範圍，並指出所給的逸散率是否落在範圍內。 */
  equipment_type?: RefrigerationEquipment;
}

export interface GasBreakdown {
  gas: Gas;
  factor_kg_per_tj: string;
  gwp: string;
  emissions_kg: string;
  emissions_kg_co2e: string;
  /** 生質燃料的 CO2：單獨表列，不計入排放總量。 */
  excluded_from_total?: boolean;
}

export interface CalcResult {
  ok: true;
  activity: { quantity: string; unit: string; converted_quantity: string; converted_unit: string };
  factor: {
    id: string;
    version: number;
    name: string;
    value: string | null;
    unit: string;
    original_unit: string;
    reference_year: number | null;
    announcement_date: string | null;
    factor_type: string;
    variant: string | null;
    methodology: string | null;
    gas_basis: string;
    gwp_version: string | null;
    significant_figures: number | null;
    source_url: string;
    source_id: string;
  };
  formula: string;
  emissions_kg: string;
  emissions_t: string;
  /** 排放量的氣體基礎：CO2e 或 CO2。兩者不可相加。 */
  emissions_gas_basis: string;
  breakdown?: GasBreakdown[];
  /** 生質燃料燃燒的 CO2（kg），單獨表列，未計入 emissions_kg。 */
  biogenic_co2_kg?: string;
  user_supplied?: {
    lower_heating_value?: { value: string; unit: string; note: string };
    refrigerant_leak?: { basis: string; leak_rate_percent: string | null; equipment_type: string | null; note: string };
  };
  calculated_at: string;
  limitations: string[];
  disclaimer: string;
}

const fail = (code: CalcErrorCode, message: string, details?: Record<string, unknown>): CalcError => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) },
});

const DECIMAL = /^\d+(\.\d+)?$/;

/** 把輸入解析成非負的精確十進位。數字先轉成字串（JS 對 0.1 這類值的最短表示是穩定的）。 */
export function parseDecimal(input: string | number | undefined): Big | null {
  if (input === undefined) return null;
  const text = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : input.trim().replace(/,/g, "");
  if (!DECIMAL.test(text)) return null;
  return new Big(text);
}

/** 不用科學記號的十進位字串。 */
const plain = (n: Big): string => n.toFixed();

/** 來源數值的有效位數（"0.530" → 3，"0.17" → 2，"74100" → null：整數尾端的零無法判斷）。 */
export function significantFigures(value: string): number | null {
  if (!value.includes(".")) return /0$/.test(value) ? null : value.replace(/^0+/, "").length;
  return value.replace(".", "").replace(/^0+/, "").length;
}

function checkYear(factor: StoredFactor, year: number | undefined, availableYears: number[]): CalcError | null {
  if (year === undefined) return null;
  if (factor.reference_year !== null) {
    if (factor.reference_year === year) return null;
    return fail(
      "year_mismatch",
      `這筆係數適用 ${factor.reference_year} 年，不是 ${year} 年。不會自動用其他年度代替；請改用 ${year} 年的係數，或明確指定要用的年度。`,
      { requested_year: year, factor_year: factor.reference_year, available_years: availableYears },
    );
  }
  if (factor.effective_from && year < Number(factor.effective_from.slice(0, 4))) {
    return fail(
      "factor_not_effective",
      `這筆係數出自 ${factor.effective_from} 生效的公告。公告沒有說明能否回溯適用；本服務的規則是不把它套用到生效前的年度（${year} 年），而本服務沒有收錄更早的版本。`,
      { requested_year: year, effective_from: factor.effective_from },
    );
  }
  return null;
}

const HEATING_UNIT = /^kcal\/(.+)$/i;

/**
 * 算一筆活動的排放量。
 * `availableYears` 只用在年度不符時告訴使用者有哪些年度可選。
 */
export function calculate(
  factor: StoredFactor,
  input: CalcInput,
  now: Date,
  availableYears: number[] = [],
): CalcResult | CalcError {
  const quantity = parseDecimal(input.quantity);
  if (!quantity) return fail("invalid_quantity", "活動數據必須是不小於零的十進位數字，例如 12000 或 \"0.5\"。");

  if (factor.calculability === "lookup_only" || factor.calculability === "pending" || factor.status !== "current") {
    return fail(
      "not_calculable",
      factor.calculability === "pending"
        ? "這筆係數的來源尚未驗證，不能用來計算。"
        : "這筆係數僅供查詢：它的單位或計算邊界不足以安全地直接計算。",
      { factor_id: factor.id, calculability: factor.calculability, usage_notes: factor.usage_notes },
    );
  }

  const yearError = checkYear(factor, input.year, availableYears);
  if (yearError) return yearError;

  try {
    if (factor.factor_type === "fugitive_emission") return fugitive(factor, quantity, input, now);
    return factor.calculability === "needs_heating_value"
      ? combustion(factor, quantity, input, now)
      : direct(factor, quantity, input, now);
  } catch (e) {
    if (e instanceof UnitError) return fail(e.code, e.message, { factor_unit: factor.denominator_unit });
    throw e;
  }
}

function factorSummary(factor: StoredFactor): CalcResult["factor"] {
  return {
    id: factor.id,
    version: factor.version,
    name: factor.name,
    value: factor.value,
    unit: `${factor.numerator_unit}${factor.gas_basis}/${factor.denominator_unit}`,
    original_unit: factor.original_unit,
    reference_year: factor.reference_year,
    announcement_date: factor.announcement_date,
    factor_type: factor.factor_type,
    variant: factor.variant,
    methodology: factor.methodology,
    gas_basis: factor.gas_basis,
    gwp_version: factor.gwp_version,
    significant_figures: factor.value ? significantFigures(factor.value) : null,
    source_url: factor.source_url,
    source_id: factor.source_id,
  };
}

function direct(factor: StoredFactor, quantity: Big, input: CalcInput, now: Date): CalcResult {
  const target = factor.denominator_unit!;
  const unit = resolveUnit(input.quantity_unit, target);
  const converted = convert(quantity, unit, target);
  const kg = converted.times(factor.value!);
  return {
    ok: true,
    activity: { quantity: plain(quantity), unit, converted_quantity: plain(converted), converted_unit: target },
    factor: factorSummary(factor),
    formula: `${plain(converted)} ${target} × ${factor.value} kg${factor.gas_basis}/${target} = ${plain(kg)} kg${factor.gas_basis}`,
    emissions_kg: plain(kg),
    emissions_t: plain(kg.times("0.001")),
    emissions_gas_basis: factor.gas_basis,
    calculated_at: now.toISOString(),
    limitations: [
      ...factor.usage_notes,
      ...(input.year === undefined && factor.reference_year !== null
        ? [`未指定活動年度；使用的是 ${factor.reference_year} 年適用的係數。`]
        : []),
    ],
    disclaimer: DISCLAIMER,
  };
}

function combustion(factor: StoredFactor, quantity: Big, input: CalcInput, now: Date): CalcResult | CalcError {
  const lhv = input.context?.lower_heating_value;
  if (!lhv) {
    return fail(
      "missing_heating_value",
      "這筆係數以熱值為基礎（kg/TJ）。官方沒有公布預設熱值，請在 context.lower_heating_value 提供低位熱值（自行檢測或供應商提供），例如 { value: \"8500\", unit: \"kcal/L\" }。本服務不會代為假設熱值。",
      { factor_id: factor.id, required: "context.lower_heating_value", accepted_units: ["kcal/L", "kcal/kg", "kcal/m3"] },
    );
  }
  const lhvValue = parseDecimal(lhv.value);
  const lhvUnit = HEATING_UNIT.exec(lhv.unit.trim());
  if (!lhvValue || lhvValue.eq(0) || !lhvUnit) {
    return fail("invalid_heating_value", "低位熱值必須是大於零的數字，單位寫成 kcal/L、kcal/kg 或 kcal/m3。");
  }
  const per = resolveUnit(lhvUnit[1]);
  const unit = resolveUnit(input.quantity_unit);
  const converted = convert(quantity, unit, per);
  const energyTj = converted.times(lhvValue).times(TJ_PER_KCAL);

  const breakdown: GasBreakdown[] = factor.components!.map((c) => {
    const gasKg = energyTj.times(c.value);
    const gwp = GWP_AR5[c.gas];
    return {
      gas: c.gas,
      factor_kg_per_tj: c.value,
      gwp,
      emissions_kg: plain(gasKg),
      emissions_kg_co2e: plain(gasKg.times(gwp)),
      ...(c.biogenic ? { excluded_from_total: true } : {}),
    };
  });
  const kg = breakdown.filter((b) => !b.excluded_from_total).reduce((sum, b) => sum.plus(b.emissions_kg_co2e), new Big(0));
  const biogenic = breakdown.find((b) => b.excluded_from_total);

  return {
    ok: true,
    activity: { quantity: plain(quantity), unit, converted_quantity: plain(converted), converted_unit: per },
    factor: factorSummary(factor),
    formula: `活動數據 ${plain(converted)} ${per} × 低位熱值 ${plain(lhvValue)} kcal/${per} × 4.1868×10⁻⁹ TJ/kcal × 排放係數（kg/TJ）× GWP（AR5），CO2、CH4、N2O 分別計算後加總 = ${plain(kg)} kgCO2e`,
    emissions_kg: plain(kg),
    emissions_t: plain(kg.times("0.001")),
    emissions_gas_basis: "CO2e",
    breakdown,
    ...(biogenic ? { biogenic_co2_kg: biogenic.emissions_kg } : {}),
    user_supplied: {
      lower_heating_value: {
        value: plain(lhvValue),
        unit: `kcal/${per}`,
        note: "低位熱值由使用者提供，不是官方資料；結果的正確性取決於這個數值。",
      },
    },
    calculated_at: now.toISOString(),
    limitations: [
      ...(biogenic ? [`生質燃料的 CO2（${biogenic.emissions_kg} kg）已單獨表列於 biogenic_co2_kg，未計入排放量。`] : []),
      ...factor.usage_notes,
    ],
    disclaimer: DISCLAIMER,
  };
}

/**
 * 含氟氣體的逸散（冷媒等）：逸散量 × 溫暖化潛勢。
 * 係數的活動數據是「逸散到大氣的質量」。使用者手上通常只有設備填充量，把填充量直接當逸散量
 * 會高估數十倍，所以這裡要求明說數量是哪一種，不替使用者假設。
 */
function fugitive(factor: StoredFactor, quantity: Big, input: CalcInput, now: Date): CalcResult | CalcError {
  const r = input.context?.refrigerant;
  const equipmentList = Object.entries(REFRIGERATION_EQUIPMENT).map(([id, e]) => ({ equipment_type: id, name: e.name, operating_percent_per_year: e.operating }));
  if (!r) {
    return fail(
      "missing_refrigerant_basis",
      "請在 context.refrigerant.basis 說明數量是哪一種：leaked_amount（實際逸散或補充的量），或 charge（設備填充量，需另給年逸散率 leak_rate_percent）。本服務不會假設，因為把填充量當成逸散量會嚴重高估。",
      { factor_id: factor.id, required: "context.refrigerant.basis", official_leak_rate_ranges: equipmentList },
    );
  }
  const unit = resolveUnit(input.quantity_unit, "kg");
  const mass = convert(quantity, unit, "kg");

  let leaked = mass;
  let rate: Big | null = null;
  const notes: string[] = [];
  if (r.basis === "charge") {
    rate = parseDecimal(r.leak_rate_percent);
    if (!rate || rate.eq(0) || rate.gt(100)) {
      return fail(
        "invalid_leak_rate",
        "以設備填充量計算時，必須提供年逸散率 leak_rate_percent（大於 0、不超過 100 的百分比）。官方附表三只提供各類設備的範圍，沒有單一預設值，請依設備實際情況提供。",
        { official_leak_rate_ranges: equipmentList },
      );
    }
    leaked = mass.times(rate).times("0.01");
    if (r.equipment_type) {
      const e = REFRIGERATION_EQUIPMENT[r.equipment_type];
      const within = rate.gte(e.operating[0]) && rate.lte(e.operating[1]);
      notes.push(
        `官方附表三「${e.name}」的運行排放範圍是每年 ${e.operating[0]}% 至 ${e.operating[1]}%；所給的 ${plain(rate)}% ${within ? "在範圍內" : "不在這個範圍內，請確認依據"}。`,
      );
    } else {
      notes.push("未指定設備類型，沒有與官方附表三的逸散率範圍比對。");
    }
  }
  const kg = leaked.times(factor.value!);

  return {
    ok: true,
    activity: { quantity: plain(quantity), unit, converted_quantity: plain(leaked), converted_unit: "kg" },
    factor: factorSummary(factor),
    formula:
      rate === null
        ? `逸散量 ${plain(leaked)} kg × GWP ${factor.value} = ${plain(kg)} kgCO2e`
        : `填充量 ${plain(mass)} kg × 年逸散率 ${plain(rate)}% × GWP ${factor.value} = ${plain(kg)} kgCO2e`,
    emissions_kg: plain(kg),
    emissions_t: plain(kg.times("0.001")),
    emissions_gas_basis: "CO2e",
    user_supplied: {
      refrigerant_leak: {
        basis: r.basis,
        leak_rate_percent: rate === null ? null : plain(rate),
        equipment_type: r.equipment_type ?? null,
        note:
          rate === null
            ? "數量由使用者聲明為實際逸散（補充）量。"
            : "年逸散率由使用者提供，不是官方的單一數值；結果的正確性取決於這個數值。",
      },
    },
    calculated_at: now.toISOString(),
    limitations: [...notes, ...factor.usage_notes],
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------- 批次

export interface BatchTotal {
  available: boolean;
  emissions_kg?: string;
  emissions_t?: string;
  emissions_gas_basis?: string;
  /** 不提供合計的原因。 */
  withheld_reasons?: string[];
  warnings: string[];
}

/** 產品生命週期碳足跡與組織盤查的係數邊界不同，不能加在一起。 */
const boundaryFamily = (factorType: string) =>
  factorType === "product_carbon_footprint" ? "product_footprint" : "organizational_inventory";

/**
 * 只有全部成功、氣體基礎一致、邊界同一類時才給合計。
 * 重複計算無法完全自動判斷，所以同一筆係數出現多次時加上提醒。
 */
export function totalOf(results: (CalcResult | CalcError)[]): BatchTotal {
  const ok = results.filter((r): r is CalcResult => r.ok);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (ok.length !== results.length) reasons.push("有項目計算失敗，合計會漏算。");
  if (new Set(ok.map((r) => r.emissions_gas_basis)).size > 1) {
    reasons.push("各項目的氣體基礎不同（CO2 與 CO2e），不能相加。");
  }
  if (new Set(ok.map((r) => boundaryFamily(r.factor.factor_type))).size > 1) {
    reasons.push("混用了產品碳足跡係數與組織盤查係數，兩者的計算邊界不同，相加可能重複計算。");
  }
  const ids = ok.map((r) => r.factor.id);
  if (new Set(ids).size !== ids.length) {
    warnings.push("同一筆係數被用了不只一次，請確認這些活動數據沒有重疊。");
  }
  if (ok.some((r) => r.factor.factor_type === "water_supply") && ok.some((r) => r.factor.factor_type === "purchased_electricity")) {
    warnings.push("自來水係數代表供水者的排放（對用水者屬其他間接排放），購入電力屬能源間接排放；彙整到盤查清冊時請分列。");
  }

  if (reasons.length || ok.length === 0) {
    return { available: false, withheld_reasons: reasons.length ? reasons : ["沒有可合計的項目。"], warnings };
  }
  const kg = ok.reduce((sum, r) => sum.plus(r.emissions_kg), new Big(0));
  return {
    available: true,
    emissions_kg: plain(kg),
    emissions_t: plain(kg.times("0.001")),
    emissions_gas_basis: ok[0].emissions_gas_basis,
    warnings,
  };
}

// ---------------------------------------------------------------- 比較

export interface Comparison {
  baseline_emissions_kg: string;
  comparison_emissions_kg: string;
  difference_kg: string;
  /** 兩邊的計算方法是否相同。不同時，差異不可直接解讀為減碳成效。 */
  method_changed: boolean;
  method_change_reasons: string[];
  /** 只有方法相同、係數單位相同時才拆解。兩項相加等於 difference_kg。 */
  decomposition: { activity_effect_kg: string; factor_effect_kg: string; explanation: string } | null;
  interpretation: string;
}

/** 單一對單一的比較與混合冷媒逐成分合併後的比較，用同一套說法。 */
export function interpret(methodChanged: boolean, decomposition: Comparison["decomposition"]): string {
  if (methodChanged) return "兩邊的計算方法或係數口徑不同，這個差異不能直接解讀為實際的減碳成效。";
  if (decomposition && !new Big(decomposition.factor_effect_kg).eq(0)) {
    return "差異中有一部分來自排放係數本身的變動，不是活動量改變造成的。係數為什麼變動，請以官方公告的說明為準。";
  }
  return "兩邊使用相同的係數與方法，差異來自活動量的變化。";
}

export function compare(baseline: CalcResult, comparison: CalcResult): Comparison {
  const a = baseline;
  const b = comparison;
  const reasons: string[] = [];
  if (a.emissions_gas_basis !== b.emissions_gas_basis) reasons.push("氣體基礎不同（CO2 與 CO2e）。");
  if (a.factor.factor_type !== b.factor.factor_type) reasons.push("係數類型不同。");
  if (a.factor.source_id !== b.factor.source_id) reasons.push("係數來自不同的官方來源。");
  if (a.factor.variant !== b.factor.variant) {
    reasons.push("兩筆係數的用途或計算口徑不同（例如電力排碳係數自 114 年度起才劃分產業盤查用與其他用途）。");
  }
  if (a.factor.methodology !== b.factor.methodology) {
    reasons.push("兩筆係數的官方計算方式不同（各年度公告記載的方法曾調整）。");
  }
  if (a.user_supplied || b.user_supplied) {
    const la = a.user_supplied?.lower_heating_value;
    const lb = b.user_supplied?.lower_heating_value;
    if (la?.value !== lb?.value || la?.unit !== lb?.unit) reasons.push("兩邊使用的低位熱值不同。");
    // 填充量乘逸散率是估算，實際逸散量是量測；兩者的差不是活動量的變化。
    const ra = a.user_supplied?.refrigerant_leak?.basis;
    const rb = b.user_supplied?.refrigerant_leak?.basis;
    if (ra && rb && ra !== rb) reasons.push("冷媒數量的計算依據不同（一邊是設備填充量乘年逸散率，一邊是實際逸散量）。");
  }

  const diff = new Big(b.emissions_kg).minus(a.emissions_kg);
  const methodChanged = reasons.length > 0;
  const sameShape =
    !methodChanged && a.factor.value !== null && b.factor.value !== null && a.activity.converted_unit === b.activity.converted_unit;

  let decomposition: Comparison["decomposition"] = null;
  if (sameShape) {
    const qa = new Big(a.activity.converted_quantity);
    const qb = new Big(b.activity.converted_quantity);
    const fa = new Big(a.factor.value!);
    const fb = new Big(b.factor.value!);
    decomposition = {
      activity_effect_kg: plain(qb.minus(qa).times(fa)),
      factor_effect_kg: plain(qb.times(fb.minus(fa))),
      explanation: "活動量效果 =（比較期活動量 − 基準期活動量）× 基準期係數；係數效果 = 比較期活動量 ×（比較期係數 − 基準期係數）。",
    };
  }

  return {
    baseline_emissions_kg: a.emissions_kg,
    comparison_emissions_kg: b.emissions_kg,
    difference_kg: plain(diff),
    method_changed: methodChanged,
    method_change_reasons: reasons,
    decomposition,
    interpretation: interpret(methodChanged, decomposition),
  };
}

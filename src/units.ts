/**
 * 單位。只允許「同一個量綱內」的換算；跨量綱（公升 → 公斤）需要密度，這裡一律拒絕。
 * 換算係數都是十的次方，用十進位字串表示，乘法是精確的。
 */
import Big from "big.js";

export type Dimension = "energy" | "volume" | "mass" | "count" | "distance" | "heat" | "length" | "area" | "freight" | "passenger";

interface UnitDef {
  dimension: Dimension;
  /** 換成該量綱基準單位的倍數。 */
  toBase: string;
}

/** 標準單位。量綱基準：kWh、L、kg、件、km、TJ。 */
const UNITS: Record<string, UnitDef> = {
  kWh: { dimension: "energy", toBase: "1" },
  MWh: { dimension: "energy", toBase: "1000" },
  mL: { dimension: "volume", toBase: "0.001" },
  L: { dimension: "volume", toBase: "1" },
  kL: { dimension: "volume", toBase: "1000" },
  m3: { dimension: "volume", toBase: "1000" },
  km3: { dimension: "volume", toBase: "1000000" },
  g: { dimension: "mass", toBase: "0.001" },
  kg: { dimension: "mass", toBase: "1" },
  t: { dimension: "mass", toBase: "1000" },
  piece: { dimension: "count", toBase: "1" },
  km: { dimension: "distance", toBase: "1" },
  TJ: { dimension: "heat", toBase: "1" },
  m: { dimension: "length", toBase: "1" },
  m2: { dimension: "area", toBase: "1" },
  tkm: { dimension: "freight", toBase: "1" },
  pkm: { dimension: "passenger", toBase: "1" },
};

/** 使用者可能寫的各種寫法 → 標準單位。鍵一律小寫、去空白。「度」不在這裡：它在電是 kWh、在水是 m³。 */
const SPELLINGS: Record<string, string> = {
  kwh: "kWh", "千瓦時": "kWh", "瓩時": "kWh", "度電": "kWh",
  mwh: "MWh", "千度": "MWh",
  l: "L", "公升": "L", liter: "L", litre: "L", liters: "L", litres: "L",
  kl: "kL", "公秉": "kL",
  m3: "m3", "m³": "m3", "立方公尺": "m3", "立方米": "m3", "度水": "m3",
  km3: "km3", "千立方公尺": "km3",
  g: "g", "公克": "g", "克": "g",
  kg: "kg", "公斤": "kg",
  t: "t", "公噸": "t", "噸": "t", tonne: "t", tonnes: "t",
  "件": "piece", piece: "piece", pcs: "piece", "個": "piece",
  km: "km", "公里": "km",
  tj: "TJ", "兆焦耳": "TJ",
  ml: "mL", "毫升": "mL",
  mt: "t",
  m: "m", "公尺": "m",
  m2: "m2", "m²": "m2", "平方公尺": "m2",
  tkm: "tkm", "延噸公里": "tkm",
  pkm: "pkm", "延人公里": "pkm",
};

export class UnitError extends Error {
  constructor(
    readonly code: "unknown_unit" | "ambiguous_unit" | "incompatible_unit",
    message: string,
  ) {
    super(message);
  }
}

/**
 * 把使用者寫的單位解析成標準單位。
 * `expected` 是係數的分母單位：「度」只有在它是 kWh 或 m³ 時才有意義，由它決定。
 */
export function resolveUnit(input: string, expected?: string | null): string {
  const key = input.trim().toLowerCase().replace(/\s+/g, "");
  if (key === "度") {
    if (expected === "kWh" || expected === "m3") return expected;
    throw new UnitError("ambiguous_unit", "「度」可以是電（kWh）也可以是水（m³），這個係數的單位兩者都不是，請改用明確的單位。");
  }
  const unit = SPELLINGS[key];
  if (!unit) throw new UnitError("unknown_unit", `不認得的單位「${input}」。支援：${supportedUnits().join("、")}。`);
  return unit;
}

export function supportedUnits(): string[] {
  return [...Object.keys(UNITS), "度（依係數為 kWh 或 m³）"];
}

export const dimensionOf = (unit: string): Dimension | null => UNITS[unit]?.dimension ?? null;

/** 同量綱換算。量綱不同就丟 UnitError，不猜。 */
export function convert(quantity: Big, from: string, to: string): Big {
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b) throw new UnitError("unknown_unit", `不認得的單位「${!a ? from : to}」。`);
  if (a.dimension !== b.dimension) {
    throw new UnitError(
      "incompatible_unit",
      `單位不相容：活動數據是 ${from}，係數需要 ${to}。兩者量綱不同，沒有密度或其他換算依據時不能換算。`,
    );
  }
  if (from === to) return quantity;
  // 兩個倍數都是十的次方，比值必為 10^n，在 Big 的預設小數位數內除法是精確的。
  const ratio = new Big(a.toBase).div(b.toBase);
  return quantity.times(ratio);
}

/**
 * 官方資料裡的宣告單位 → 標準單位；無法辨識回 null（這種係數只供查詢）。
 * 環境部的寫法是「公斤(kg)」「度(kwh)」：括號裡的縮寫比中文明確（「度」單獨出現時有歧義），所以先看括號。
 * 「個」「件」這類計數單位一律回 null：每件產品的碳足跡只對那個產品有意義，不能當成通用的「件」。
 */
export function normalizeDeclaredUnit(declared: string): string | null {
  const text = declared.trim().toLowerCase().replace(/\s+/g, "");
  const abbr = /[(（]([^)）]+)[)）]$/.exec(text)?.[1];
  const unit = (abbr && SPELLINGS[abbr]) ?? SPELLINGS[text] ?? null;
  return unit && UNITS[unit].dimension !== "count" ? unit : null;
}

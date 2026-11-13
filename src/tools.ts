/**
 * MCP 工具的定義表。server.ts 用它註冊工具，網站的工具說明與 llms.txt 也從這裡產生，
 * 所以工具名稱、說明與參數只有這一份。
 *
 * 每個工具只是服務層（service.ts）的薄殼：REST API 呼叫的是同一批函式。
 * 說明文字英文在前、繁體中文在後，寫在同一個字串裡。
 */
import { z } from "zod";

import {
  calculateAny, calculateBatch, compareEmissions, electricity, factorDetail, factorVersions, listDataSources,
  MAX_BATCH, MAX_BLEND_COMPONENTS, methodology, METHODOLOGY_TOPICS, ping, search, updateStatus, USAGE_TYPES,
} from "./service";
import { REFRIGERATION_EQUIPMENT, type RefrigerationEquipment } from "./data/reviewed";
import { buildInventory } from "./inventory";
import { matchActivity, MAX_CANDIDATES } from "./match";
import { MAX_LIMIT } from "./store";

const CATEGORIES = ["electricity", "water", "fuel_combustion", "refrigerant", "product_footprint"] as const;
const FACTOR_TYPES = ["purchased_electricity", "water_supply", "stationary_combustion", "mobile_combustion", "fugitive_emission", "product_carbon_footprint"] as const;

const quantity = z
  .union([z.number(), z.string()])
  .describe('活動數據，不小於零。可用數字或十進位字串（字串可避免精度問題），例如 12000 或 "17.495"。');

const heatingValue = z
  .object({
    value: z.union([z.number(), z.string()]).describe("低位熱值的數值，例如 8500。"),
    unit: z.string().describe('單位，寫成 "kcal/L"、"kcal/kg" 或 "kcal/m3"。'),
  })
  .describe("低位熱值。燃料燃燒係數必填，必須來自使用者（自行檢測或供應商提供）；官方沒有預設值，請勿自行假設。");

const refrigerant = z
  .object({
    basis: z.enum(["leaked_amount", "charge"]).describe("數量是哪一種：leaked_amount 是實際逸散或補充的量；charge 是設備填充量（需另給 leak_rate_percent）。"),
    leak_rate_percent: z.union([z.number(), z.string()]).optional().describe("年逸散率（%），basis 為 charge 時必填。官方只提供各類設備的範圍，請向使用者確認，勿自行假設。"),
    equipment_type: z
      .enum(Object.keys(REFRIGERATION_EQUIPMENT) as [RefrigerationEquipment, ...RefrigerationEquipment[]])
      .optional()
      .describe("設備類型。有給就會與官方附表三的逸散率範圍比對，例如 residential_commercial_ac（住宅及商業建築空調）、chiller（冰水機）、mobile_ac（車輛空調）。"),
  })
  .describe("冷媒等含氟氣體逸散的計算依據。必須由使用者提供，本服務不會假設數量是填充量還是逸散量。");

/** 一筆活動的計算參數。calculate_emissions、calculate_batch、compare_emissions 與 REST 共用。 */
export const calcShape = {
  factor_id: z.string().min(1).max(120).describe("係數 ID，來自 search_emission_factors 或 get_electricity_factor 的結果。請勿自行猜測。"),
  quantity,
  quantity_unit: z.string().min(1).max(20).describe("活動數據的單位，例如 kWh、度、L、公秉、kg、t、m3。「度」在電是 kWh、在水是 m³。"),
  year: z.number().int().min(1990).max(2100).optional().describe("活動發生的年度（西元）。有給就必須與係數的適用年度相符，不會自動以其他年度代替。"),
  optional_context: z
    .object({ lower_heating_value: heatingValue.optional(), refrigerant: refrigerant.optional() })
    .optional()
    .describe("補充資料。燃料燃燒係數需要 lower_heating_value；冷媒等含氟氣體的逸散需要 refrigerant。"),
  factor_version: z.number().int().min(1).optional().describe("指定係數版本，用來重現過去的計算。不給就用目前版本。"),
};
export const calcSchema = z.object(calcShape);

const blend = z
  .object({
    components: z
      .array(
        z.object({
          factor_id: z.string().min(1).max(120).describe("成分的係數 ID（公告附表四的含氟氣體），來自 search_emission_factors，例如查 R-32、HFC-125。"),
          mass_percent: z.union([z.number(), z.string()]).describe("這個成分的質量百分比，例如 50。"),
        }),
      )
      .min(2)
      .max(MAX_BLEND_COMPONENTS)
      .describe("各成分與其質量百分比，合計必須剛好是 100。"),
  })
  .describe("混合冷媒（例如 R-410A）。成分比例必須來自使用者或設備、冷媒的規格文件；本服務沒有內建任何冷媒的成分，請勿憑記憶填寫，不確定時請向使用者確認。");

/** calculate_emissions 與清冊項目：單一係數（factor_id）或混合冷媒（refrigerant_blend），兩者擇一。 */
export const calcOrBlendShape = {
  ...calcShape,
  factor_id: calcShape.factor_id.optional(),
  refrigerant_blend: blend.optional(),
};
export const calcOrBlendSchema = z.object(calcOrBlendShape);
export const toAnyRequest = (a: z.infer<typeof calcOrBlendSchema>) => ({ ...toRequest({ ...a, factor_id: a.factor_id ?? "" }), factor_id: a.factor_id, blend: a.refrigerant_blend?.components });
type CalcArgs = z.infer<typeof calcSchema>;

const toRequest = (a: CalcArgs) => ({
  factor_id: a.factor_id,
  quantity: a.quantity,
  quantity_unit: a.quantity_unit,
  year: a.year,
  context: a.optional_context,
  factor_version: a.factor_version,
});

export const searchShape = {
  query: z.string().max(100).optional().describe("關鍵字，繁體中文或英文，例如 電力、柴油、自來水、gasoline。多個關鍵字以空白分隔。"),
  category: z.enum(CATEGORIES).optional().describe("類別：electricity 電力、water 自來水、fuel_combustion 燃料燃燒、refrigerant 冷媒等含氟氣體、product_footprint 產品碳足跡。"),
  factor_type: z.enum(FACTOR_TYPES).optional().describe("係數類型，用來區分固定燃燒與移動燃燒等。"),
  year: z.number().int().min(1990).max(2100).optional().describe("適用年度（西元）。"),
  unit: z.string().max(20).optional().describe("係數分母的單位，例如 kWh、m3、TJ。"),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`回傳筆數，預設 10，上限 ${MAX_LIMIT}。`),
  offset: z.number().int().min(0).optional().describe("略過前幾筆（分頁用）。"),
};

export const matchShape = {
  description: z.string().min(1).max(200).describe("活動或會計科目的描述，例如「10 月電費」「公務車加油」「塑膠原料採購」。"),
  unit: z.string().max(20).optional().describe("活動數據的單位，例如 kWh、度、L、kg。有給就會檢查每筆候選的單位是否相容。"),
  year: z.number().int().min(1990).max(2100).optional().describe("活動發生的年度（西元）。不給時，逐年公布的係數只列最新年度。"),
  limit: z.number().int().min(1).max(MAX_CANDIDATES).optional().describe(`回傳的候選筆數，預設 10，上限 ${MAX_CANDIDATES}。`),
};

export const electricityShape = {
  year: z.number().int().min(1990).max(2100).describe("適用年度（西元），例如 2025。"),
  usage_type: z
    .enum(USAGE_TYPES)
    .optional()
    .describe("用途別（114 年度起才有劃分）：industry_inventory 產業盤查使用；residential_tariff 表燈非營業與包燈用戶；utility_average 公用售電業整體平均。不給就回該年度全部數值。"),
};

export const batchShape = {
  items: z.array(calcSchema).min(1).max(MAX_BATCH).describe(`要計算的活動，最多 ${MAX_BATCH} 筆。`),
};

export const inventoryItemSchema = calcOrBlendSchema.extend({
  label: z.string().max(80).optional().describe("這筆活動的名稱，例如「總公司電費」。只用來讓清冊好讀。"),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("覆寫預設的範疇分類（1、2 或 3）。組織邊界使某筆活動不屬於預設範疇時使用。"),
});

export const inventoryShape = {
  inventory_year: z.number().int().min(1990).max(2100).optional().describe("盤查年度（西元）。會套用到沒有自己指定 year 的項目，係數年度不符的項目會回報錯誤。"),
  items: z.array(inventoryItemSchema).min(1).max(MAX_BATCH).describe(`要列入清冊的活動，最多 ${MAX_BATCH} 筆。`),
};

export const toInventoryItem = (a: z.infer<typeof inventoryItemSchema>) => ({ ...toAnyRequest(a), label: a.label, scope: a.scope });

export const compareShape = {
  baseline: calcSchema.describe("基準（例如去年）。"),
  comparison: calcSchema.describe("比較對象（例如今年）。"),
};

export interface ToolContext {
  db: D1Database;
  now: Date;
}

export interface ToolDef {
  name: string;
  title: string;
  /** 英文在前、繁體中文在後。 */
  description: string;
  /** 網站與 llms.txt 用的一句話說明。 */
  summary: { zh: string; en: string; ja: string };
  shape: Record<string, z.ZodType>;
  run: (args: never, ctx: ToolContext) => unknown;
}

const def = <S extends Record<string, z.ZodType>>(
  d: Omit<ToolDef, "shape" | "run"> & { shape: S; run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => unknown },
): ToolDef => d as unknown as ToolDef;

export const TOOLS: ToolDef[] = [
  def({
    name: "ping",
    title: "Ping",
    description: "Check that the service is up. Returns status, service name, version and server time. 確認服務狀態，回傳狀態、服務名稱、版本與伺服器時間。",
    summary: { zh: "確認服務是否正常。", en: "Check that the service is up.", ja: "サービスの稼働状況を確認します。" },
    shape: {},
    run: (_a, { now }) => ping(now),
  }),
  def({
    name: "list_data_sources",
    title: "List data sources",
    description:
      "List the official Taiwan government sources behind this service, with dataset codes, URLs, licence, sync status and how many factors each holds. 列出本服務整合的官方資料來源：資料集代碼、網址、授權、同步狀態與係數數量。",
    summary: { zh: "列出已整合的官方資料來源與狀態。", en: "List the official data sources and their status.", ja: "統合済みの公式データソースと状態を一覧します。" },
    shape: {},
    run: (_a, { db }) => listDataSources(db),
  }),
  def({
    name: "search_emission_factors",
    title: "Search emission factors",
    description:
      "Search official Taiwan emission factors by keyword, category, type, year or unit. Returns factor IDs to pass to get_emission_factor and calculate_emissions. Covers electricity, tap water and fuel combustion; returns an explicit not-found message rather than a near match. 以關鍵字、類別、類型、年度或單位搜尋台灣官方排放係數，回傳的係數 ID 可交給 get_emission_factor 與 calculate_emissions。目前收錄電力、自來水與燃料燃燒；查不到會明確說明，不會給相近的替代品。",
    summary: { zh: "以關鍵字、類別、年度搜尋排放係數。", en: "Search emission factors by keyword, category or year.", ja: "キーワード・分類・年度で排出係数を検索します。" },
    shape: searchShape,
    run: (a, { db }) => search(db, a),
  }),
  def({
    name: "match_activity",
    title: "Match activity to candidate factors",
    description:
      "Map an activity or ledger-account description (for example an electricity bill, fleet fuel, or a plastic resin purchase) plus an optional unit to candidate official factors. Returns candidates with unit compatibility, applicability conditions and the questions the user must answer; it never picks one. Use this when the user's wording is not an official factor name, then confirm with the user before calling calculate_emissions. The term mapping is curated by this service, not official. 把活動或會計科目的描述（例如電費、公務車加油、塑膠原料採購）與單位對到候選的官方係數，回傳每筆的單位相容性、適用條件與需要使用者回答的問題；不會代為選定。使用者的說法不是官方係數名稱時用這個工具，並在呼叫 calculate_emissions 之前先向使用者確認。用詞對照是本服務整理的，不是官方資料。",
    summary: { zh: "把活動描述對到候選係數，列出適用條件供確認。", en: "Map an activity description to candidate factors for confirmation.", ja: "活動の説明から候補の係数を挙げ、適用条件とともに確認を求めます。" },
    shape: matchShape,
    run: (a, { db }) => matchActivity(db, a),
  }),
  def({
    name: "get_emission_factor",
    title: "Get emission factor",
    description:
      "Get one factor in full by ID: the original government record, unit, applicable year, boundary, official source, version, whether it can be used for calculation directly, and usage limits. Find the ID with search_emission_factors first. 依係數 ID 取得完整資訊：官方原始紀錄、單位、適用年度、計算邊界、官方來源、版本、是否可直接計算與使用限制。請先用 search_emission_factors 找到 ID。",
    summary: { zh: "取得單一係數的完整資訊與使用限制。", en: "Get one factor in full, with its usage limits.", ja: "係数1件の詳細と利用上の制約を取得します。" },
    shape: {
      factor_id: z.string().min(1).max(120).describe("係數 ID，來自 search_emission_factors。"),
      version: z.number().int().min(1).optional().describe("指定版本；不給就是目前版本。"),
    },
    run: (a, { db }) => factorDetail(db, a.factor_id, a.version),
  }),
  def({
    name: "get_electricity_factor",
    title: "Get electricity factor",
    description:
      "Get Taiwan's official electricity emission factor (kgCO2e/kWh) for a given year, published by the Energy Administration. From the 2025 factor year there are three values by usage; earlier years have one. Never substitutes another year: if the year is missing it says so and lists the years available. 查詢經濟部能源署公布的指定年度電力排碳係數（公斤CO2e/度）。114 年度（2025）起依用途有三個數值，之前每年一個。不會以其他年度代替：該年度沒有資料時會明說並列出可用年度。",
    summary: { zh: "查詢指定年度的台灣電力排碳係數。", en: "Get Taiwan's electricity emission factor for a year.", ja: "指定年度の台湾の電力排出係数を取得します。" },
    shape: electricityShape,
    run: (a, { db }) => electricity(db, a.year, a.usage_type),
  }),
  def({
    name: "calculate_emissions",
    title: "Calculate emissions",
    description:
      "Calculate emissions for one activity: activity data × an official factor from the database. Checks units, the applicable year and whether the factor may be used for calculation, and returns the formula, kg and tonnes, the factor version and the source URL. Returns a clear error instead of guessing when the unit is incompatible, the year does not match or required data is missing (fuel factors need a user-supplied lower heating value; refrigerants need the basis of the quantity). A refrigerant blend such as R-410A can be calculated by passing refrigerant_blend with the user-supplied composition instead of factor_id. 計算單一活動的排放量：活動數據 × 資料庫中的官方係數。會檢查單位、適用年度與係數是否可用於計算，回傳公式、公斤與公噸、係數版本與來源網址。單位不相容、年度不符或缺少必要資料時（燃料係數需要使用者提供低位熱值，冷媒需要說明數量的依據）回傳明確錯誤，不會猜測。混合冷媒（如 R-410A）可不給 factor_id，改以 refrigerant_blend 提供使用者確認過的成分比例。",
    summary: { zh: "用官方係數計算單一活動的排放量。", en: "Calculate emissions for one activity with an official factor.", ja: "公式係数で1件の活動の排出量を計算します。" },
    shape: calcOrBlendShape,
    run: (a, { db, now }) => calculateAny(db, toAnyRequest(a), now),
  }),
  def({
    name: "calculate_batch",
    title: "Calculate batch",
    description:
      "Calculate several activities at once, each with its own factor and source. A total is given only when every item succeeded and the items share a gas basis and boundary type; otherwise the reason is stated. 批次計算多筆活動，逐筆回傳結果與來源。只有全部成功、氣體基礎與邊界類型一致時才提供合計，否則說明不提供的原因。",
    summary: { zh: "批次計算多筆活動，條件相容時才給合計。", en: "Calculate several activities; totals only when compatible.", ja: "複数の活動を一括計算します。条件が揃う場合のみ合計を返します。" },
    shape: batchShape,
    run: (a, { db, now }) => calculateBatch(db, a.items.map(toRequest), now),
  }),
  def({
    name: "build_inventory",
    title: "Build GHG inventory summary",
    description:
      "Calculate several activities and arrange the results as a greenhouse gas inventory: grouped into Scope 1 (direct), Scope 2 (purchased energy) and Scope 3 (other indirect), with a subtotal per scope, Scope 1 by gas, and a Scope 1+2 total. Subtotals and totals are withheld, with the reason, when items mix CO2 and CO2e, when an item could not be calculated, or when Scope 3 holds product carbon footprints that may overlap Scopes 1 and 2. The scope assignment is this service's default by factor type and can be overridden per item. Covers only the activities supplied; it is not a complete or verified inventory. 計算多筆活動並整理成溫室氣體盤查清冊的形式：分為範疇一（直接排放）、範疇二（能源間接）、範疇三（其他間接），提供各範疇小計、範疇一依氣體分列，以及範疇一加二的合計。項目混用 CO2 與 CO2e、有項目算不出來、或範疇三含可能與範疇一、二重疊的產品碳足跡時，不提供對應的小計或合計並說明原因。範疇分類是本服務依係數類型的預設，可逐筆覆寫。只涵蓋你提供的活動，不是完整或經查證的盤查。",
    summary: { zh: "計算多筆活動並依範疇一、二、三彙整成清冊。", en: "Calculate activities and summarise them by Scope 1, 2 and 3.", ja: "複数の活動を計算し、スコープ1・2・3別に集計します。" },
    shape: inventoryShape,
    run: (a, { db, now }) => buildInventory(db, a.items.map(toInventoryItem), a.inventory_year, now),
  }),
  def({
    name: "compare_emissions",
    title: "Compare emissions",
    description:
      "Compare two calculations (for example two years). Separates the effect of changed activity data from the effect of a changed factor, and flags when the calculation method differs so the difference is not read as an actual reduction. 比較兩筆計算（例如不同年度）。區分活動量改變與排放係數改變的影響；計算方法不同時會標示，避免把差異誤讀為實際減碳成效。",
    summary: { zh: "比較兩筆排放量，區分活動量與係數的影響。", en: "Compare two results, separating activity and factor effects.", ja: "2件の排出量を比較し、活動量と係数の影響を分けて示します。" },
    shape: compareShape,
    run: (a, { db, now }) => compareEmissions(db, toRequest(a.baseline), toRequest(a.comparison), now),
  }),
  def({
    name: "list_factor_versions",
    title: "List factor versions",
    description: "List every recorded version of one factor, newest first. Old versions are kept so past calculations can be reproduced. 列出指定係數的所有歷史版本（新的在前）。舊版本會保留，讓過去的計算可以重現。",
    summary: { zh: "列出係數的歷史版本。", en: "List a factor's version history.", ja: "係数の改訂履歴を一覧します。" },
    shape: { factor_id: z.string().min(1).max(120).describe("係數 ID，來自 search_emission_factors。") },
    run: (a, { db }) => factorVersions(db, a.factor_id),
  }),
  def({
    name: "check_factor_updates",
    title: "Check factor updates",
    description:
      "Show the sync status of each official source: when it was last checked, whether the data may be stale, and whether a difference from the official data is waiting for review. Read-only; it cannot trigger a sync or write anything. 查看各官方來源的同步狀態：最近檢查時間、資料是否可能過期、是否有與官方資料不一致而待審核的項目。唯讀，不能觸發同步或寫入。",
    summary: { zh: "查看各資料來源的同步與更新狀態。", en: "Show each source's sync and update status.", ja: "各データソースの同期・更新状況を表示します。" },
    shape: {},
    run: (_a, { db }) => updateStatus(db),
  }),
  def({
    name: "get_methodology",
    title: "Get methodology",
    description:
      "Explain the calculation methods, scope, data limits and official references. Read this before interpreting results or combining different kinds of factors. 說明計算方法、適用範圍、資料限制與官方依據。解讀結果或合併不同類型的係數之前請先閱讀。",
    summary: { zh: "說明計算方法、適用範圍與資料限制。", en: "Explain the methods, scope and data limits.", ja: "計算方法・適用範囲・データの制約を説明します。" },
    shape: { topic: z.enum(METHODOLOGY_TOPICS as [string, ...string[]]).optional().describe("主題；不給就回全部。") },
    run: (a) => methodology(a.topic as (typeof METHODOLOGY_TOPICS)[number] | undefined),
  }),
];

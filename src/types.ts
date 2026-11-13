/**
 * 領域型別。詞彙：
 * - 係數（factor）：一筆官方公布的排放係數，或一組依氣體分列的係數（燃料）。
 * - reference_year：係數「適用」的年度（資料年度）。不是公告年份。
 * - announcement_*：官方公告的年份／日期。只存在官方頁面上觀察到的值，推論的一律 null。
 */

export type Category = "electricity" | "water" | "fuel_combustion" | "product_footprint";

export type FactorType =
  | "purchased_electricity"
  | "water_supply"
  | "stationary_combustion"
  | "mobile_combustion"
  | "product_carbon_footprint";

/** 係數分子的氣體基礎。CO2 與 CO2e 不可相加（台水公布的是 CO2）。 */
export type GasBasis = "CO2e" | "CO2";

export type Gas = "CO2" | "CH4" | "N2O";

/**
 * 能不能直接拿來算：
 * - direct：活動量 × 係數即可。
 * - needs_heating_value：係數以熱值為基礎（kg/TJ），使用者必須提供低位熱值。
 * - lookup_only：只能查，不能算（邊界或單位語意不足以安全計算）。
 * - pending：來源尚未驗證。
 */
export type Calculability = "direct" | "needs_heating_value" | "lookup_only" | "pending";

export type SourceStatus = "active" | "pending_key" | "pending_verification";

export interface DataSource {
  id: string;
  organization: string;
  dataset_code: string | null;
  dataset_name: string;
  official_url: string;
  api_url: string | null;
  /** 授權條款名稱。未能在官方頁面確認時為 null，並在 license_note 說明。 */
  license: string | null;
  license_note: string | null;
  update_frequency: string | null;
  ingestion: "api_sync" | "reviewed_import";
  status: SourceStatus;
  notes: string | null;
}

export interface SourceDocument {
  id: string;
  source_id: string;
  title: string;
  url: string;
  /** 官方頁面上觀察到的發布日期（ISO）。沒觀察到就是 null。 */
  published_date: string | null;
  document_ref: string | null;
  sha256: string | null;
  format: string;
  reviewed_at: string;
  notes: string | null;
}

export interface GasComponent {
  gas: Gas;
  /** 十進位字串，kg/TJ。 */
  value: string;
}

export interface Factor {
  id: string;
  source_id: string;
  document_id: string | null;
  source_record_id: string | null;
  name: string;
  name_en: string | null;
  aliases: string[];
  category: Category;
  factor_type: FactorType;
  /** 同一來源、同一年度下的區分（例如電力的用途別、燃料的控制技術）。 */
  variant: string | null;
  gas_basis: GasBasis;
  /** 單一數值的係數；燃料這種分氣體的係數為 null，數值在 components。十進位字串，照官方公布的寫法。 */
  value: string | null;
  components: GasComponent[] | null;
  numerator_unit: "kg";
  /** 標準化後的分母單位（見 units.ts）。無法標準化的宣告單位為 null，此時 calculability 不會是 direct。 */
  denominator_unit: string | null;
  /** 來源的原始單位寫法。 */
  original_unit: string;
  reference_year: number | null;
  announcement_year: number | null;
  announcement_date: string | null;
  effective_from: string | null;
  effective_to: string | null;
  scope: string | null;
  lifecycle_boundary: string | null;
  /** 邊界是來源明文寫的（stated）還是從引用文獻推論的（inferred）。 */
  boundary_basis: "stated" | "inferred" | null;
  methodology: string | null;
  gwp_version: string | null;
  calculability: Calculability;
  usage_notes: string[];
  source_url: string;
  /** 來源的原始紀錄，原樣保留。 */
  original: Record<string, unknown> | null;
}

/** 資料庫中的係數：多了版本與時間。 */
export interface StoredFactor extends Factor {
  version: number;
  status: "current" | "withdrawn";
  retrieved_at: string;
  content_hash: string;
}

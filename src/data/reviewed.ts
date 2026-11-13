/**
 * 人工審核後匯入的官方資料。
 *
 * 這些來源沒有可靠的結構化 API（或 API 缺少關鍵數值），所以數值寫在這裡，經 git 審查進版，
 * 由排程的 importReviewed 寫入 D1（見 store.ts 的 upsertFactors）。**這是這些資料唯一的寫入路徑。**
 *
 * 規則：
 * - 數值照官方文件的寫法抄（PDF 寫 0.530 就是 "0.530"；CSV 寫 0.17 就是 "0.17"）。
 * - 只寫在官方頁面／檔案上觀察到的事實。推論的日期一律 null。
 * - 查證日期：2026-11-13。
 */
import type { DataSource, Factor, SourceDocument } from "../types";

const REVIEWED_AT = "2026-11-13";
const OGDL = "政府資料開放授權條款－第1版";

export const SOURCES: DataSource[] = [
  {
    id: "moea-electricity",
    organization: "經濟部能源署",
    dataset_code: null,
    dataset_name: "電力排碳係數",
    official_url: "https://www.moeaea.gov.tw/ecw/populace/content/ContentDesc.aspx?menu_id=27028",
    api_url: "https://www.moeaea.gov.tw/ECW/populace/opendata/wHandOpenData_File.ashx?set_id=13",
    license: null,
    license_note:
      "年度公告為 PDF，其重製授權未能在官方頁面確認。data.gov.tw 資料集 8308「能源指標年資料」（僅含公用售電業單一數列）標示為政府資料開放授權條款。",
    update_frequency: "每年",
    ingestion: "reviewed_import",
    status: "active",
    notes:
      "114 年度（2025）起劃分三個數值，只存在於年度 PDF；開放資料 CSV 只有公用售電業的 0.467，所以 CSV 只用來交叉檢查，不直接寫入係數。",
  },
  {
    id: "twc-water",
    organization: "台灣自來水公司",
    dataset_code: "25681",
    dataset_name: "台灣自來水公司每度用水CO2排放量",
    official_url: "https://www.water.gov.tw/ch/Subject/Detail/2269?nodeId=813",
    api_url: "https://www.water.gov.tw/opendata/sale3.csv",
    license: OGDL,
    license_note: "data.gov.tw 資料集 25681。",
    update_frequency: "每年",
    ingestion: "reviewed_import",
    status: "active",
    notes: "官方頁面的單位寫的是 CO2，不是 CO2e。邊界為該公司用電與用油。",
  },
  {
    id: "tpe-water",
    organization: "臺北自來水事業處",
    dataset_code: "155475",
    dataset_name: "臺北市每度水排放二氧化碳(CO2)約當量",
    official_url: "https://data.gov.tw/dataset/155475",
    api_url:
      "https://data.taipei/api/dataset/a7ef99ef-21a3-4806-a264-512ff9ffcd6c/resource/52de4b17-234c-44f5-9312-245381f9d9f3/download",
    license: OGDL,
    license_note: "data.gov.tw 資料集 155475。",
    update_frequency: "每年",
    ingestion: "reviewed_import",
    status: "active",
    notes: "CSV 的數值是算法一（類別1＋類別2）÷總配水量。服務區域與台灣自來水公司不同，兩者不可混用。",
  },
  {
    id: "moenv-ghg-factors",
    organization: "環境部",
    dataset_code: null,
    dataset_name: "公告「溫室氣體排放係數」（113年2月5日）",
    official_url: "https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=1",
    api_url: null,
    license: null,
    license_note: "事業溫室氣體排放量資訊平台檔案的重製授權未能確認（環境部網站資料開放宣告頁面查證時回應 403）。",
    update_frequency: "不定期",
    ingestion: "reviewed_import",
    status: "active",
    notes:
      "只提供 PDF 與 ODS，無 API。係數以低位熱值為基礎（kg/TJ），分 CO2、CH4、N2O；官方不提供預設熱值，也不提供每公升係數。目前只匯入常用燃料，其餘列（製程、逸散、其他燃料）尚未匯入。",
  },
  {
    id: "moenv-cfp",
    organization: "環境部氣候變遷署",
    dataset_code: "CFP_P_02",
    dataset_name: "碳足跡排放係數",
    official_url: "https://data.moenv.gov.tw/dataset/detail/CFP_P_02",
    api_url: "https://data.moenv.gov.tw/api/v2/cfp_p_02",
    license: OGDL,
    license_note: "環境部環境資料開放平臺標示依政府資料開放平臺使用規範；data.gov.tw 資料集 28176。",
    update_frequency: "不定期",
    ingestion: "api_sync",
    status: "pending_key",
    notes:
      "API 必須帶會員 API Key。尚未以金鑰實測，回應結構與紀錄唯一性未驗證，所以還沒有任何係數匯入。這是產品碳足跡係數，不代表適合直接用於組織溫室氣體盤查。",
  },
];

const ELEC_PDF = (menu: number, file: number) =>
  `https://www.moeaea.gov.tw/ecw/populace/content/wHandMenuFile.ashx?menu_id=${menu}&file_id=${file}`;

export const DOCUMENTS: SourceDocument[] = [
  { id: "moea-elec-110", source_id: "moea-electricity", title: "110年度電力排碳係數", url: ELEC_PDF(20850, 10994), published_date: null, document_ref: null, sha256: null, format: "pdf", reviewed_at: REVIEWED_AT, notes: "含 94 至 110 年度歷年數值表。" },
  { id: "moea-elec-111", source_id: "moea-electricity", title: "111年度電力排碳係數", url: ELEC_PDF(23142, 15275), published_date: null, document_ref: null, sha256: null, format: "pdf", reviewed_at: REVIEWED_AT, notes: null },
  { id: "moea-elec-112", source_id: "moea-electricity", title: "112年度電力排碳係數", url: ELEC_PDF(26391, 16499), published_date: null, document_ref: null, sha256: null, format: "pdf", reviewed_at: REVIEWED_AT, notes: null },
  { id: "moea-elec-113", source_id: "moea-electricity", title: "113年度電力排碳係數", url: ELEC_PDF(26678, 16728), published_date: "2025-04-14", document_ref: null, sha256: null, format: "pdf", reviewed_at: REVIEWED_AT, notes: "公布日期見能源署新聞：114年4月14日公布。" },
  { id: "moea-elec-114", source_id: "moea-electricity", title: "114年度電力排碳係數", url: ELEC_PDF(27028, 17083), published_date: "2026-06-02", document_ref: null, sha256: null, format: "pdf", reviewed_at: REVIEWED_AT, notes: "自本年度起劃分產業盤查使用與表燈非營業、包燈用戶適用之係數。" },
  { id: "twc-water-page", source_id: "twc-water", title: "台灣自來水公司每度用水CO2排放量", url: "https://www.water.gov.tw/opendata/sale3.csv", published_date: "2026-09-08", document_ref: null, sha256: null, format: "csv", reviewed_at: REVIEWED_AT, notes: "發布日期為官方說明頁面標示的日期。" },
  { id: "tpe-water-csv", source_id: "tpe-water", title: "臺北市每度水排放二氧化碳(CO2)約當量", url: "https://data.taipei/api/dataset/a7ef99ef-21a3-4806-a264-512ff9ffcd6c/resource/52de4b17-234c-44f5-9312-245381f9d9f3/download", published_date: null, document_ref: null, sha256: null, format: "csv", reviewed_at: REVIEWED_AT, notes: null },
  { id: "moenv-ghg-1130205", source_id: "moenv-ghg-factors", title: "113年2月5日公告溫室氣體排放係數", url: "https://ghgregistry.moenv.gov.tw/upload/Tools/AI/113年2月5日公告溫室氣體排放係數.ods", published_date: "2024-02-05", document_ref: "環部授氣字第1139101231號", sha256: "085fe962e158078e5b3383568b4eeeda0466373ae2d0f62f7870efa0a0dcd0b0", format: "ods", reviewed_at: REVIEWED_AT, notes: "數值已與同一公告的 PDF（sha256 f809a27150c014e1cb3bde3133cc433a8be5fe1f14105e63903970540ba9d623）抽核一致。" },
];

// ---------------------------------------------------------------- 電力

const ELEC_BOUNDARY = "購買及使用公用售電業電力所間接承擔的燃料燃燒溫室氣體排放。";
const ELEC_ALIASES = ["電力", "用電", "電力排碳係數", "電力排放係數", "electricity", "grid electricity", "power"];

/** 94–113 年度（2005–2024）：每年只公布一個數值。[西元年, 數值, 文件] */
const ELEC_SINGLE: [number, string, string][] = [
  [2005, "0.555", "moea-elec-110"], [2006, "0.562", "moea-elec-110"], [2007, "0.558", "moea-elec-110"],
  [2008, "0.555", "moea-elec-110"], [2009, "0.543", "moea-elec-110"], [2010, "0.534", "moea-elec-110"],
  [2011, "0.534", "moea-elec-110"], [2012, "0.529", "moea-elec-110"], [2013, "0.519", "moea-elec-110"],
  [2014, "0.518", "moea-elec-110"], [2015, "0.525", "moea-elec-110"], [2016, "0.530", "moea-elec-110"],
  [2017, "0.554", "moea-elec-110"], [2018, "0.533", "moea-elec-110"], [2019, "0.509", "moea-elec-110"],
  [2020, "0.502", "moea-elec-110"], [2021, "0.509", "moea-elec-110"], [2022, "0.495", "moea-elec-111"],
  [2023, "0.494", "moea-elec-112"], [2024, "0.474", "moea-elec-113"],
];

function electricity(
  year: number,
  variant: string,
  value: string,
  documentId: string,
  name: string,
  nameEn: string,
  aliases: string[],
  notes: string[],
  methodology: string,
): Factor {
  const doc = DOCUMENTS.find((d) => d.id === documentId)!;
  return {
    id: variant === "single" ? `tw-electricity-${year}` : `tw-electricity-${year}-${variant.replaceAll("_", "-")}`,
    source_id: "moea-electricity",
    document_id: documentId,
    source_record_id: null,
    name,
    name_en: nameEn,
    aliases: [...ELEC_ALIASES, ...aliases],
    category: "electricity",
    factor_type: "purchased_electricity",
    variant,
    gas_basis: "CO2e",
    value,
    components: null,
    numerator_unit: "kg",
    denominator_unit: "kWh",
    original_unit: "公斤CO2e/度",
    reference_year: year,
    announcement_year: doc.published_date ? Number(doc.published_date.slice(0, 4)) : null,
    announcement_date: doc.published_date,
    effective_from: null,
    effective_to: null,
    scope: "能源間接排放（購入電力）",
    lifecycle_boundary: ELEC_BOUNDARY,
    boundary_basis: "stated",
    methodology,
    gwp_version: null,
    calculability: "direct",
    usage_notes: notes,
    source_url: doc.url,
    original: { 年度: year - 1911, 數值: value, 單位: "公斤CO2e/度" },
  };
}

const ELEC_METHOD_BASE = "公用售電業電力排碳係數，作為計算購買及使用公用售電業電力所需間接承擔燃料燃燒溫室氣體排放量之依據。";

/**
 * 各年度公告記載的計算方式調整（本服務依公告內容摘要，非官方原文）。
 * 方法不同的年度之間，係數的差異不完全代表電網排放強度的變化；compare 靠這段文字是否相同來判斷。
 */
function electricityMethod(year: number): string {
  if (year >= 2023) return `${ELEC_METHOD_BASE}111年度公告起調整焚化廠售電的排碳量計算方式；112年度公告起不含直供、轉供予用戶的再生能源。`;
  if (year === 2022) return `${ELEC_METHOD_BASE}111年度公告起調整焚化廠售電的排碳量計算方式。`;
  return ELEC_METHOD_BASE;
}

const ELEC_FACTORS: Factor[] = [
  ...ELEC_SINGLE.map(([year, value, doc]) =>
    electricity(
      year, "single", value, doc,
      `${year - 1911}年度電力排碳係數`,
      `Taiwan electricity emission factor ${year}`,
      [],
      [
        "該年度經濟部能源署只公布一個電力排碳係數，沒有依用途劃分。",
        ...(year <= 2020 ? ["數值取自 110 年度公告所附的歷年數值表。"] : []),
        "只適用於購買公用售電業（台電）的電力；直供、轉供的再生能源與非公用售電業電力不適用。",
      ],
      electricityMethod(year),
    ),
  ),
  electricity(
    2025, "utility_average", "0.467", "moea-elec-114",
    "114年度公用售電業電力排碳係數", "Taiwan electricity emission factor 2025 (public utility average)",
    ["公用售電業", "整體平均"],
    [
      "官方說明的適用範圍：檢視公用售電業整體銷售電量之平均電力排碳情形，作為電業管制機關進行管理之依據。",
      "組織盤查請用「產業盤查使用之電力排碳係數」（0.466），不要用這一個。",
    ],
    "（發電業及自用發電設備設置者躉售公用售電業電量之電力排碳量 − 線損承擔之電力排碳量）÷ 公用售電業總銷售電量。",
  ),
  electricity(
    2025, "industry_inventory", "0.466", "moea-elec-114",
    "114年度產業盤查使用之電力排碳係數", "Taiwan electricity emission factor 2025 (for industry GHG inventory)",
    ["產業", "產業用電", "盤查", "產業盤查", "營業用電", "辦公室用電", "industry"],
    [
      "官方說明的適用對象：電價種類中之表燈營業、低壓電力、高壓電力、特高壓電力用戶。",
      "只適用於購買公用售電業（台電）的電力。",
    ],
    "考量產業購買較多綠電，114年劃分產業盤查使用之電力排碳係數。",
  ),
  electricity(
    2025, "residential_tariff", "0.471", "moea-elec-114",
    "114年度表燈非營業、包燈用戶適用之電力排碳係數", "Taiwan electricity emission factor 2025 (non-commercial lighting tariff)",
    ["表燈非營業", "包燈", "民生", "住宅", "民生住宅", "家庭用電", "residential", "household"],
    [
      "官方說明的適用對象：電價種類為表燈非營業、包燈用戶。",
      "「民生住宅」是經濟部商業服務業節能減碳專區對這個係數的稱呼，能源署公告本身沒有用這個詞。",
    ],
    "電價種類為表燈非營業、包燈用戶適用之電力排碳係數。",
  ),
];

// ---------------------------------------------------------------- 自來水

const WATER_ALIASES = ["自來水", "用水", "water", "tap water"];

/** 台灣自來水公司，民國年 → 公斤 CO2／度（照 CSV 寫法，不補零）。 */
const TWC: [number, string][] = [
  [96, "0.175"], [97, "0.17"], [98, "0.167"], [99, "0.169"], [100, "0.167"], [101, "0.164"], [102, "0.156"],
  [103, "0.155"], [104, "0.154"], [105, "0.152"], [106, "0.162"], [107, "0.16"], [108, "0.15"], [109, "0.152"],
  [110, "0.161"], [111, "0.152"], [112, "0.158"], [113, "0.15"], [114, "0.151"],
];

/** 臺北自來水事業處，民國年 → 公斤／度（算法一）。 */
const TPE: [number, string][] = [
  [107, "0.0665"], [108, "0.0633"], [109, "0.058"], [110, "0.0554"], [111, "0.0544"], [112, "0.0555"],
  [113, "0.0513"], [114, "0.0502"],
];

const WATER_FACTORS: Factor[] = [
  ...TWC.map(([roc, value]): Factor => ({
    id: `twc-water-${roc + 1911}`,
    source_id: "twc-water",
    document_id: "twc-water-page",
    source_record_id: String(roc),
    name: `台灣自來水公司${roc}年度每度水排放二氧化碳量`,
    name_en: `Taiwan Water Corporation CO2 per m3 of water ${roc + 1911}`,
    aliases: [...WATER_ALIASES, "台水", "台灣自來水公司"],
    category: "water",
    factor_type: "water_supply",
    variant: "taiwan_water_corporation",
    gas_basis: "CO2",
    value,
    components: null,
    numerator_unit: "kg",
    denominator_unit: "m3",
    original_unit: "公斤CO2/度",
    reference_year: roc + 1911,
    announcement_year: null,
    announcement_date: null,
    effective_from: null,
    effective_to: null,
    scope: "自來水供應（供水者的用電與用油）",
    lifecycle_boundary: "（台灣自來水公司總用電量產生 CO2 量 + 總用油量產生 CO2 量）÷ 總供水量。",
    boundary_basis: "stated",
    methodology: "用電排放採經濟部能源署公告之電力排放係數計算。",
    gwp_version: null,
    calculability: "direct",
    usage_notes: [
      "官方公布的單位是 CO2，不是 CO2e，不可與 CO2e 的結果直接相加。",
      "只適用於台灣自來水公司供水區域；臺北自來水事業處供水區域另有係數。",
    ],
    source_url: "https://www.water.gov.tw/ch/Subject/Detail/2269?nodeId=813",
    original: { 年度: roc, CO2排放量: value, 單位: "公斤" },
  })),
  ...TPE.map(([roc, value]): Factor => ({
    id: `tpe-water-${roc + 1911}`,
    source_id: "tpe-water",
    document_id: "tpe-water-csv",
    source_record_id: String(roc),
    name: `臺北自來水事業處${roc}年度每度水排放二氧化碳約當量`,
    name_en: `Taipei Water Department CO2e per m3 of water ${roc + 1911}`,
    aliases: [...WATER_ALIASES, "北水", "臺北自來水", "台北自來水"],
    category: "water",
    factor_type: "water_supply",
    variant: "taipei_water_department",
    gas_basis: "CO2e",
    value,
    components: null,
    numerator_unit: "kg",
    denominator_unit: "m3",
    original_unit: "公斤/度",
    reference_year: roc + 1911,
    announcement_year: null,
    announcement_date: null,
    effective_from: null,
    effective_to: null,
    scope: "自來水供應（供水者的類別1與類別2排放）",
    lifecycle_boundary: "算法一：（類別1 + 類別2）÷ 總配水量。",
    boundary_basis: "stated",
    methodology: "依 ISO 14064-1 盤查結果計算。",
    gwp_version: null,
    calculability: "direct",
    usage_notes: [
      "只適用於臺北自來水事業處供水區域；其他地區請用台灣自來水公司的係數。",
      "各年度的盤查方法可能經過修正，跨年度比較時請留意。",
    ],
    source_url: "https://data.gov.tw/dataset/155475",
    original: { 年度: roc, 數值: value, 單位: "公斤" },
  })),
];

// ---------------------------------------------------------------- 燃料燃燒

type Sheet = "stationary" | "mobile";

function fuel(
  sheet: Sheet,
  slug: string,
  name: string,
  nameEn: string,
  aliases: string[],
  co2: string,
  ch4: string,
  n2o: string,
  extraNotes: string[] = [],
): Factor {
  const sheetName = sheet === "stationary" ? "固定燃燒" : "移動燃燒";
  return {
    id: `moenv-ghg-2024-${sheet}-${slug}`,
    source_id: "moenv-ghg-factors",
    document_id: "moenv-ghg-1130205",
    source_record_id: `附表一/${sheetName}/${name}`,
    name: `${name}（${sheetName}）`,
    name_en: `${nameEn} (${sheet} combustion)`,
    aliases,
    category: "fuel_combustion",
    factor_type: sheet === "stationary" ? "stationary_combustion" : "mobile_combustion",
    variant: slug,
    gas_basis: "CO2e",
    value: null,
    components: [
      { gas: "CO2", value: co2 },
      { gas: "CH4", value: ch4 },
      { gas: "N2O", value: n2o },
    ],
    numerator_unit: "kg",
    denominator_unit: "TJ",
    original_unit: "公斤/兆焦耳(kg/TJ)",
    reference_year: null,
    announcement_year: 2024,
    announcement_date: "2024-02-05",
    effective_from: "2024-02-05",
    effective_to: null,
    scope: sheet === "stationary" ? "直接排放（固定燃燒）" : "直接排放（移動燃燒）",
    lifecycle_boundary: "燃料燃燒階段的 CO2、CH4、N2O 排放。",
    boundary_basis: "inferred",
    methodology:
      "排放量 = 活動數據 × 低位熱值 × 4.1868×10⁻⁹ TJ/kcal × 排放係數 × 溫暖化潛勢。係數基於低位熱值，引用 2006 IPCC Guidelines Volume 2。",
    gwp_version: "AR5",
    calculability: "needs_heating_value",
    usage_notes: [
      "係數單位是每兆焦耳（kg/TJ），官方沒有公布每公升或每公斤的係數，也沒有公布預設熱值。",
      "計算時必須自行提供低位熱值（自行檢測或供應商提供）。",
      "「只涵蓋燃燒階段、不含上游」是依其引用的 IPCC 燃燒排放係數表推論，公告本身沒有明文說明。",
      "不可用產品碳足跡係數取代這個係數。",
      ...extraNotes,
    ],
    source_url: "https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=1",
    original: { 附表: `附表一、${sheetName}排放源排放係數`, 燃料: name, CO2: co2, CH4: ch4, N2O: n2o, 單位: "kg/TJ" },
  };
}

const MOBILE_GASOLINE_NOTE = "移動燃燒的車用汽油依控制技術有三組 CH4、N2O 係數，請依車輛實際情況選擇，官方沒有指定預設。";

const FUEL_FACTORS: Factor[] = [
  fuel("stationary", "motor-gasoline", "車用汽油", "Motor Gasoline", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "3", "0.6"),
  fuel("stationary", "diesel", "柴油", "Gas/Diesel Oil", ["柴油", "diesel"], "74100", "3", "0.6"),
  fuel("stationary", "residual-fuel-oil", "燃料油", "Residual Fuel Oil", ["燃料油", "重油", "fuel oil"], "77400", "3", "0.6"),
  fuel("stationary", "lpg", "液化石油氣", "Liquefied Petroleum Gases", ["液化石油氣", "LPG", "桶裝瓦斯"], "63100", "1", "0.1"),
  fuel("stationary", "natural-gas", "天然氣", "Natural Gas", ["天然氣", "natural gas", "瓦斯"], "56100", "1", "0.1"),
  fuel("mobile", "motor-gasoline-uncontrolled", "車用汽油-未控制", "Motor Gasoline - Uncontrolled", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "33", "3.2", [MOBILE_GASOLINE_NOTE]),
  fuel("mobile", "motor-gasoline-oxidation-catalyst", "車用汽油-氧化觸媒", "Motor Gasoline - Oxidation Catalyst", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "25", "8", [MOBILE_GASOLINE_NOTE]),
  fuel("mobile", "motor-gasoline-low-mileage-ldv-1995", "車用汽油-1995年後之低里程輕型車輛", "Motor Gasoline - Low Mileage Light Duty Vehicle Vintage 1995 or Later", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "3.8", "5.7", [MOBILE_GASOLINE_NOTE]),
  fuel("mobile", "diesel", "柴油", "Gas/Diesel Oil", ["柴油", "diesel"], "74100", "3.9", "3.9"),
  fuel("mobile", "lpg", "液化石油氣", "Liquefied Petroleum Gases", ["液化石油氣", "LPG"], "63100", "62", "0.2"),
];

export const FACTORS: Factor[] = [...ELEC_FACTORS, ...WATER_FACTORS, ...FUEL_FACTORS];

/** 公告附表四的溫暖化潛勢（IPCC AR5）。燃燒排放的 CH4 用 28，與盤查作業指引 113 年版的算例一致。 */
export const GWP_AR5 = { CO2: "1", CH4: "28", N2O: "265" } as const;

/** 盤查作業指引 113 年版：1 kcal = 4.1868 × 10⁻⁹ TJ。 */
export const TJ_PER_KCAL = "0.0000000041868";

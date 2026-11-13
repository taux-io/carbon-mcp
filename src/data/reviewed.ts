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
      "只提供 PDF 與 ODS，無 API。已匯入附表一固定燃燒全部燃料與部分移動燃燒燃料（kg/TJ，分 CO2、CH4、N2O，需自備低位熱值）、附表四含氟氣體的溫暖化潛勢（用於冷媒等逸散）。附表二製程與附表三的廢水、廢棄物是公式與參數，尚未匯入。",
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
      "API 必須帶會員 API Key；未設定金鑰時不會同步。來源沒有紀錄 ID，且有少數紀錄的名稱、單位、發布單位、公告年份相同而數值不同，這些紀錄僅供查詢。這是產品碳足跡係數，不代表適合直接用於組織溫室氣體盤查。",
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
  biogenic = false,
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
      biogenic ? { gas: "CO2", value: co2, biogenic: true } : { gas: "CO2", value: co2 },
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

const BIOGENIC_NOTE = "生質燃料：燃燒產生的 CO2 需計算並單獨表列，但不計入排放總量；CH4 與 N2O 計入總量（環境部盤查作業指引）。";

/** 附表一固定燃燒的其餘列。[slug, 名稱, 英譯, 所屬大類, CO2, CH4, N2O（kg/TJ）, 是否為生質燃料] */
const OTHER_STATIONARY_FUELS: [string, string, string, string | null, string, string, string, boolean][] = [
  ["crude-oil", "原油", "Crude Oil", null, "73300", "3", "0.6", false],
  ["orimulsion", "奧里油", "Orimulsion", null, "77000", "3", "0.6", false],
  ["natural-gas-liquids-ngls", "液化天然氣", "Natural Gas Liquids (NGLs)", null, "64200", "3", "0.6", false],
  ["aviation-gasoline", "航空汽油", "Aviation Gasoline", "汽油", "70000", "3", "0.6", false],
  ["jet-gasoline", "航空燃油-汽油型", "Jet Gasoline", "汽油", "70000", "3", "0.6", false],
  ["jet-kerosene", "航空燃油-煤油型", "Jet Kerosene", null, "71500", "3", "0.6", false],
  ["other-kerosene", "其他煤油", "Other Kerosene", null, "71900", "3", "0.6", false],
  ["shale-oil", "頁岩油", "Shale Oil", null, "73300", "3", "0.6", false],
  ["ethane", "乙烷", "Ethane", null, "61600", "1", "0.1", false],
  ["naphtha", "石油腦", "Naphtha", null, "73300", "3", "0.6", false],
  ["bitumen", "瀝青", "Bitumen", null, "80700", "3", "0.6", false],
  ["lubricants", "潤滑油", "Lubricants", null, "73300", "3", "0.6", false],
  ["petroleum-coke", "石油焦", "Petroleum Coke", null, "97500", "3", "0.6", false],
  ["refinery-feedstocks", "煉油廠進料", "Refinery Feedstocks", null, "73300", "3", "0.6", false],
  ["refinery-gas", "煉油氣", "Refinery Gas", "其他油品", "57600", "1", "0.1", false],
  ["paraffin-waxes", "石蠟", "Paraffin Waxes", "其他油品", "73300", "3", "0.6", false],
  ["white-spirit-sbp", "白精油", "White Spirit & SBP", "其他油品", "73300", "3", "0.6", false],
  ["other-petroleum-products", "其他石油產品", "Other Petroleum Products", "其他油品", "73300", "3", "0.6", false],
  ["anthracite", "無煙煤", "Anthracite", null, "98300", "1", "1.5", false],
  ["coking-coal", "煉焦煤", "Coking Coal", null, "94600", "1", "1.5", false],
  ["other-bituminous-coal", "其他煙煤", "Other Bituminous Coal", null, "94600", "1", "1.5", false],
  ["sub-bituminous-coal", "亞煙煤", "Sub-Bituminous Coal", null, "96100", "1", "1.5", false],
  ["lignite", "褐煤", "Lignite", null, "101000", "1", "1.5", false],
  ["oil-shale-and-tar-sands", "油頁岩/焦油砂", "Oil Shale and Tar Sands", null, "107000", "1", "1.5", false],
  ["brown-coal-briquettes", "褐煤塊", "Brown Coal Briquettes", null, "97500", "1", "1.5", false],
  ["patent-fuel", "煤球", "Patent Fuel", null, "97500", "1", "1.5", false],
  ["coke-oven-coke-and-lignite-coke", "焦炭", "Coke Oven Coke and Lignite Coke", "焦炭", "107000", "1", "1.5", false],
  ["gas-coke", "煤氣焦碳", "Gas Coke", "焦炭", "107000", "1", "0.1", false],
  ["coal-tar", "煤焦油", "Coal Tar", null, "80700", "1", "1.5", false],
  ["gas-works-gas", "煤氣廠氣體", "Gas Works Gas", "衍生氣體", "44400", "1", "0.1", false],
  ["coke-oven-gas", "焦爐氣", "Coke Oven Gas", "衍生氣體", "44400", "1", "0.1", false],
  ["blast-furnace-gas", "高爐氣", "Blast Furnace Gas", "衍生氣體", "260000", "1", "0.1", false],
  ["oxygen-steel-furnace-gas", "轉爐氣", "Oxygen Steel Furnace Gas", "衍生氣體", "182000", "1", "0.1", false],
  ["municipal-wastes-non-biomass-fraction", "都市廢棄物 - 非生質部分", "Municipal Wastes (non-biomass fraction)", null, "91700", "30", "4", false],
  ["industrial-wastes", "事業廢棄物", "Industrial Wastes", null, "143000", "30", "4", false],
  ["waste-oils", "廢油", "Waste Oils", null, "73300", "30", "4", false],
  ["peat", "泥煤", "Peat", null, "106000", "1", "1.5", false],
  ["wood-wood-waste", "木材/ 廢材", "Wood/Wood Waste", "固體生質燃料", "112000", "30", "4", true],
  ["sulphite-lyes-black-liquor", "亞硫酸鹽廢液 / 黑液", "Sulphite lyes (Black Liquor)", "固體生質燃料", "95300", "3", "2", true],
  ["other-primary-solid-biomass", "其他初級固體生質", "Other Primary Solid Biomass", "固體生質燃料", "100000", "30", "4", true],
  ["charcoal", "木炭", "Charcoal", "固體生質燃料", "112000", "200", "4", true],
  ["biogasoline", "生質汽油", "Biogasoline", "液體生質燃料", "70800", "3", "0.6", true],
  ["biodiesels", "生質柴油", "Biodiesels", "液體生質燃料", "70800", "3", "0.6", true],
  ["other-liquid-biofuels", "其他液體生質燃料", "Other Liquid Biofuels", "液體生質燃料", "79600", "3", "0.6", true],
  ["landfill-gas", "掩埋沼氣", "Landfill Gas", "氣體生質燃料", "54600", "1", "0.1", true],
  ["sludge-gas", "污泥沼氣", "Sludge Gas", "氣體生質燃料", "54600", "1", "0.1", true],
  ["other-biogas", "其他氣體生質燃料", "Other Biogas", "氣體生質燃料", "54600", "1", "0.1", true],
  ["municipal-wastes-biomass-fraction", "都市廢棄物 - 生質部分", "Municipal Wastes (biomass fraction)", "其他非石化燃料", "100000", "30", "4", true],
];

/** 附表四的含氟氣體（「<1」僅需定性者不收）。[slug, 中文名, 縮寫或英文名, 化學式, 類別, GWP] */
const FLUORINATED_GWP: [string, string, string, string, string, string][] = [
  ["hfc-23", "三氟甲烷", "HFC-23", "CHF3", "HFCs", "12400"],
  ["hfc-32", "二氟甲烷", "HFC-32", "CH2F2", "HFCs", "677"],
  ["hfc-41", "一氟甲烷", "HFC-41", "CH3F", "HFCs", "116"],
  ["hfc-125", "1,1,1,2,2-五氟乙烷", "HFC-125", "CHF2CF3", "HFCs", "3170"],
  ["hfc-134", "1,1,2,2-四氟乙烷", "HFC-134", "CHF2CHF2", "HFCs", "1120"],
  ["hfc-134a", "1,1,1,2-四氟乙烷", "HFC-134a", "CH2FCF3", "HFCs", "1300"],
  ["hfc-143", "1,1,2-三氟乙烷", "HFC-143", "CH2FCHF2", "HFCs", "328"],
  ["hfc-143a", "1,1,1-三氟乙烷", "HFC-143a", "CH3CF3", "HFCs", "4800"],
  ["hfc-152", "1,2-二氟乙烷", "HFC-152", "CH2FCH2F", "HFCs", "16"],
  ["hfc-152a", "1,1-二氟乙烷", "HFC-152a", "CH3CHF2", "HFCs", "138"],
  ["hfc-161", "一氟乙烷", "HFC-161", "CH3CH2F", "HFCs", "4"],
  ["hfc-227ca", "1,1,1,2,2,3,3-七氟丙烷", "HFC-227ca", "CF3CF2CHF2", "HFCs", "2640"],
  ["hfc-227ea", "1,1,1,2,3,3,3-七氟丙烷", "HFC-227ea", "CF3CHFCF3", "HFCs", "3350"],
  ["hfc-236cb", "1,1,1,2,2,3-六氟丙烷", "HFC-236cb", "CH2FCF2CF3", "HFCs", "1210"],
  ["hfc-236ea", "1,1,1,2,3,3-六氟丙烷", "HFC-236ea", "CHF2CHFCF3", "HFCs", "1330"],
  ["hfc-236fa", "1,1,1,3,3,3-六氟丙烷", "HFC-236fa", "CF3CH2CF3", "HFCs", "8060"],
  ["hfc-245ca", "1,1,2,2,3-五氟丙烷", "HFC-245ca", "CH2FCF2CHF2", "HFCs", "716"],
  ["hfc-245cb", "1,1,1,2,2-五氟丙烷", "HFC-245cb", "CF3CF2CH3", "HFCs", "4620"],
  ["hfc-245ea", "1,1,2,3,3-五氟丙烷", "HFC-245ea", "CHF2CHFCHF2", "HFCs", "235"],
  ["hfc-245eb", "1,1,1,2,3-五氟丙烷", "HFC-245eb", "CH2FCHFCF3", "HFCs", "290"],
  ["hfc-245fa", "1,1,1,3,3-五氟丙烷", "HFC-245fa", "CHF2CH2CF3", "HFCs", "858"],
  ["hfc-263fb", "1,1,1-三氟丙烷", "HFC-263fb", "CH3CH2CF3", "HFCs", "76"],
  ["hfc-272ca", "2,2-二氟丙烷", "HFC-272ca", "CH3CF2CH3", "HFCs", "144"],
  ["hfc-329p", "1,1,1,2,2,3,3,4,4-九氟丁烷", "HFC-329p", "CHF2CF2CF2CF3", "HFCs", "2360"],
  ["hfc-365mfc", "1,1,1,3,3-五氟丁烷", "HFC-365mfc", "CH3CF2CH2CF3", "HFCs", "804"],
  ["hfc-43-10mee", "1,1,1,2,2,3,4,5,5,5-十氟戊烷", "HFC-43-10mee", "CF3CHFCHFCF2CF3", "HFCs", "1650"],
  ["z-hfc-1336", "（順）1,1,1,3,3,3-六氟2-丁烯", "(Z)-HFC-1336", "CF3CH=CHCF3(Z)", "HFCs", "2"],
  ["nitrogen-trifluoride", "三氟化氮", "Nitrogen trifluoride", "NF3", "PFCs 及其他全氟化物", "16100"],
  ["sulphur-hexafluoride", "六氟化硫", "Sulphur hexafluoride", "SF6", "PFCs 及其他全氟化物", "23500"],
  ["trifluoromethyl-sulphur-pentafluoride", "三氟甲基五氟化硫（(Trifluoromethyl） sulphur pentafluoride）", "三氟甲基五氟化硫（(Trifluoromethyl） sulphur pentafluoride）", "SF5CF3", "PFCs 及其他全氟化物", "17400"],
  ["sulphuryl-fluoride", "硫醯氟", "Sulphuryl fluoride", "SO2F2", "PFCs 及其他全氟化物", "4090"],
  ["pfc-14", "四氟化碳", "PFC-14", "CF4", "PFCs 及其他全氟化物", "6630"],
  ["pfc-116", "六氟乙烷", "PFC-116", "C2F6", "PFCs 及其他全氟化物", "11100"],
  ["pfc-c216", "PFC-c216", "PFC-c216", "c-C3F6", "PFCs 及其他全氟化物", "9200"],
  ["pfc-218", "全氟丙烷", "PFC-218", "C3F8", "PFCs 及其他全氟化物", "8900"],
  ["pfc-318", "八氟環丁烷", "PFC-318", "c-C4F8", "PFCs 及其他全氟化物", "9540"],
  ["pfc-31-10", "全氟丁烷", "PFC-31-10", "C4F10", "PFCs 及其他全氟化物", "9200"],
  ["perfluorocyclopentene", "全氟環戊烯", "Perfluorocyclopentene", "c-C5F8", "PFCs 及其他全氟化物", "2"],
  ["pfc-41-12", "全氟戊烷", "PFC-41-12", "n-C5F12", "PFCs 及其他全氟化物", "8550"],
  ["pfc-51-14", "全氟己烷", "PFC-51-14", "n-C6F14", "PFCs 及其他全氟化物", "7910"],
  ["pfc-61-16", "全氟庚烷", "PFC-61-16", "n-C7F16", "PFCs 及其他全氟化物", "7820"],
  ["pfc-71-18", "全氟辛烷", "PFC-71-18", "C8F18", "PFCs 及其他全氟化物", "7620"],
  ["pfc-91-18", "全氟萘烷", "PFC-91-18", "C10F18", "PFCs 及其他全氟化物", "7190"],
  ["perfluorodecalin-cis", "順式全氟萘烷", "Perfluorodecalin (cis)", "Z-C10F18", "PFCs 及其他全氟化物", "7240"],
  ["perfluorodecalin-trans", "反式全氟萘烷", "Perfluorodecalin (trans)", "E-C10F18", "PFCs 及其他全氟化物", "6290"],
  ["perfluorobut-2-ene", "2-全氟丁烯", "Perfluorobut-2-ene", "CF3CF=CFCF3", "PFCs 及其他全氟化物", "2"],
];

/**
 * 附表三「冷凍及空調」的排放係數：設備初始填充量的百分比／年。官方給的是範圍，不是單一數值，
 * 所以計算時逸散率由使用者提供，這張表只用來提示與檢查。[下限, 上限]。
 */
export const REFRIGERATION_EQUIPMENT = {
  household_refrigeration: { name: "家用的冷凍、冷藏裝備", initial: ["0.2", "1"], operating: ["0.1", "0.5"] },
  standalone_commercial_refrigeration: { name: "獨立商用的冷凍、冷藏裝備", initial: ["0.5", "3"], operating: ["1", "15"] },
  medium_large_commercial_refrigeration: { name: "中、大型的冷凍、冷藏裝備", initial: ["0.5", "3"], operating: ["10", "35"] },
  transport_refrigeration: { name: "運輸用的冷凍、冷藏裝備", initial: ["0.2", "1"], operating: ["15", "50"] },
  industrial_refrigeration: { name: "工業冷凍、冷藏裝備，包括食品加工及冷藏", initial: ["0.5", "3"], operating: ["7", "25"] },
  chiller: { name: "冰水機", initial: ["0.2", "1"], operating: ["2", "15"] },
  residential_commercial_ac: { name: "住宅及商業建築空調", initial: ["0.2", "1"], operating: ["1", "10"] },
  mobile_ac: { name: "車輛空調冷媒", initial: ["0.2", "0.5"], operating: ["10", "20"] },
} as const;

export type RefrigerationEquipment = keyof typeof REFRIGERATION_EQUIPMENT;

/** HFC-134a 的冷媒編號就是 R-134a；非 HFC 的氣體沒有這種對應。 */
const refrigerantAliases = (abbr: string): string[] => {
  const m = /^HFC-(.+)$/.exec(abbr);
  return m ? [`R-${m[1]}`, `R${m[1]}`] : [];
};

const GWP_FACTORS: Factor[] = FLUORINATED_GWP.map(([slug, zh, abbr, formula, family, gwp]): Factor => ({
  id: `moenv-gwp-2024-${slug}`,
  source_id: "moenv-ghg-factors",
  document_id: "moenv-ghg-1130205",
  source_record_id: `附表四/${abbr}`,
  name: zh === abbr ? abbr : `${zh}（${abbr}）`,
  name_en: abbr,
  aliases: [abbr, formula, ...refrigerantAliases(abbr), "冷媒", "refrigerant"],
  category: "refrigerant",
  factor_type: "fugitive_emission",
  variant: family,
  gas_basis: "CO2e",
  value: gwp,
  components: null,
  numerator_unit: "kg",
  denominator_unit: "kg",
  original_unit: "溫暖化潛勢（GWP）",
  reference_year: null,
  announcement_year: 2024,
  announcement_date: "2024-02-05",
  effective_from: "2024-02-05",
  effective_to: null,
  scope: "直接排放（逸散）",
  lifecycle_boundary: "該氣體逸散到大氣的排放，以溫暖化潛勢換算為 CO2e。",
  boundary_basis: "stated",
  methodology: "排放量 = 逸散量 × 溫暖化潛勢。以設備填充量估算時：逸散量 = 填充量 × 年逸散率。溫暖化潛勢採公告附表四（IPCC AR5）。",
  gwp_version: "AR5",
  calculability: "direct",
  usage_notes: [
    "數值是溫暖化潛勢（GWP），活動數據是「逸散到大氣的氣體質量」，不是設備的填充量。",
    "計算時必須說明數量是實際逸散（補充）量，還是設備填充量；以填充量計算需另外提供年逸散率。",
    "官方附表三只提供各類設備逸散率的範圍，沒有單一預設值，本服務不會代為選定逸散率。",
    "附表四只列純物質。R-410A、R-407C 這類混合冷媒不在表內，可用 refrigerant_blend 計算（calculate_emissions、calculate_batch、compare_emissions、build_inventory 都接受）：由使用者提供各成分的質量百分比，逐成分計算後加總。本服務沒有內建任何冷媒的成分比例。",
  ],
  source_url: "https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=1",
  original: { 附表: "附表四、溫暖化潛勢", 名稱: zh, 縮寫: abbr, 化學式: formula, 溫暖化潛勢: gwp },
}));

const MOBILE_GASOLINE_NOTE = "移動燃燒的車用汽油依控制技術有三組 CH4、N2O 係數，請依車輛實際情況選擇，官方沒有指定預設。";

const FUEL_FACTORS: Factor[] = [
  fuel("stationary", "motor-gasoline", "車用汽油", "Motor Gasoline", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "3", "0.6"),
  fuel("stationary", "diesel", "柴油", "Gas/Diesel Oil", ["柴油", "diesel"], "74100", "3", "0.6"),
  fuel("stationary", "residual-fuel-oil", "燃料油", "Residual Fuel Oil", ["燃料油", "重油", "fuel oil"], "77400", "3", "0.6"),
  fuel("stationary", "lpg", "液化石油氣", "Liquefied Petroleum Gases", ["液化石油氣", "LPG", "桶裝瓦斯"], "63100", "1", "0.1"),
  fuel("stationary", "natural-gas", "天然氣", "Natural Gas", ["天然氣", "natural gas", "瓦斯"], "56100", "1", "0.1"),
  ...OTHER_STATIONARY_FUELS.map(([slug, name, en, group, co2, ch4, n2o, biogenic]) =>
    fuel("stationary", slug, name, en, [name, en, ...(group ? [group] : [])], co2, ch4, n2o, [
      ...(biogenic ? [BIOGENIC_NOTE] : []),
      ...(slug === "natural-gas-liquids-ngls" ? ["官方中文名稱是「液化天然氣」，英譯為 Natural Gas Liquids (NGLs)，不是 LNG。"] : []),
    ], biogenic),
  ),
  fuel("mobile", "motor-gasoline-uncontrolled", "車用汽油-未控制", "Motor Gasoline - Uncontrolled", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "33", "3.2", [MOBILE_GASOLINE_NOTE]),
  fuel("mobile", "motor-gasoline-oxidation-catalyst", "車用汽油-氧化觸媒", "Motor Gasoline - Oxidation Catalyst", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "25", "8", [MOBILE_GASOLINE_NOTE]),
  fuel("mobile", "motor-gasoline-low-mileage-ldv-1995", "車用汽油-1995年後之低里程輕型車輛", "Motor Gasoline - Low Mileage Light Duty Vehicle Vintage 1995 or Later", ["汽油", "車用汽油", "gasoline", "petrol"], "69300", "3.8", "5.7", [MOBILE_GASOLINE_NOTE]),
  fuel("mobile", "diesel", "柴油", "Gas/Diesel Oil", ["柴油", "diesel"], "74100", "3.9", "3.9"),
  fuel("mobile", "lpg", "液化石油氣", "Liquefied Petroleum Gases", ["液化石油氣", "LPG"], "63100", "62", "0.2"),
];

export const FACTORS: Factor[] = [...ELEC_FACTORS, ...WATER_FACTORS, ...FUEL_FACTORS, ...GWP_FACTORS];

/** 公告附表四的溫暖化潛勢（IPCC AR5）。燃燒排放的 CH4 用 28，與盤查作業指引 113 年版的算例一致。 */
export const GWP_AR5 = { CO2: "1", CH4: "28", N2O: "265" } as const;

/** 盤查作業指引 113 年版：1 kcal = 4.1868 × 10⁻⁹ TJ。 */
export const TJ_PER_KCAL = "0.0000000041868";

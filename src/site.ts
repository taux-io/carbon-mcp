/**
 * 公開網站：首頁（`/`、`/en`、`/ja`）、`/tools`、`/api/docs`、`llms.txt`、`llms-full.txt`、robots、sitemap。
 *
 * 全部在載入模組時算成字串，沒有框架、沒有外部資源。
 * 頁面上唯一會執行的腳本是「一鍵複製」（COPY_SCRIPT），CSP 只以它的 SHA-256 放行
 * （COPY_SCRIPT_HASH 由腳本本身計算，改了腳本不會忘記改雜湊）。JSON-LD 是 data block，不受 script-src 管轄。
 *
 * 工具列表、官方資料來源、計算方法都從 tools.ts / reviewed.ts / service.ts 產生，不在這裡重打。
 * 各語系文案用 Record<Locale, Copy>：少一個翻譯或少一個 FAQ 都是型別錯誤。
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { SOURCES } from "./data/reviewed";
import { ATTRIBUTION, METHODOLOGY_TOPICS, SERVICE_NAME, VERSION, MAX_BATCH, methodology } from "./service";
import { TOOLS } from "./tools";
import type { SourceStatus } from "./types";

export type Locale = "zh" | "en" | "ja";
const SITE_ORIGIN = "https://carbon.taux.io";
const MCP_ENDPOINT = `${SITE_ORIGIN}/mcp`;
const REPO = "https://github.com/taux-io/carbon-mcp";
const LICENSE_URL = "https://data.gov.tw/license";
const LASTMOD = "2026-11-13";
const SITE_NAME = "Taiwan Carbon Open Data";
const LOCALES: Record<Locale, { path: string; lang: string; hreflang: string; label: string; ogLocale: string }> = {
  zh: { path: "/", lang: "zh-Hant-TW", hreflang: "zh-Hant", label: "繁體中文", ogLocale: "zh_TW" },
  en: { path: "/en", lang: "en", hreflang: "en", label: "English", ogLocale: "en_US" },
  ja: { path: "/ja", lang: "ja", hreflang: "ja", label: "日本語", ogLocale: "ja_JP" },
};
const LOCALE_KEYS = Object.keys(LOCALES) as Locale[];

/** 複製按鈕的腳本。按鈕預設 hidden，由腳本打開，沒有腳本就不會出現一顆按了沒反應的按鈕。 */
export const COPY_SCRIPT =
  'for(const b of document.querySelectorAll("button.copy")){b.hidden=false;' +
  'b.addEventListener("click",async()=>{const t=b.parentElement.querySelector("code").textContent;' +
  'try{await navigator.clipboard.writeText(t);const o=b.getAttribute("aria-label");' +
  'const s=b.parentElement.querySelector("[role=status]");' +
  'b.classList.add("done");b.setAttribute("aria-label",b.dataset.done);b.title=b.dataset.done;s.textContent=b.dataset.done;' +
  'setTimeout(()=>{b.classList.remove("done");b.setAttribute("aria-label",o);b.title=o;s.textContent=""},2500)}catch{}})}';
export const COPY_SCRIPT_HASH = createHash("sha256").update(COPY_SCRIPT).digest("base64");

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON.stringify 不處理 <，內容裡一個 </script> 就會提早結束區塊。 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

type Tup<T, N extends number, R extends T[] = []> = R["length"] extends N ? R : Tup<T, N, [...R, T]>;

type ClientId = "chatgpt" | "cursor" | "codex" | "vscode" | "gemini" | "generic";
const json = (o: unknown) => JSON.stringify(o, null, 2);
const CLAUDE_CODE_CMD = `claude mcp add --transport http carbon ${MCP_ENDPOINT}`;
const CLIENT_ORDER: ClientId[] = ["chatgpt", "cursor", "codex", "vscode", "gemini", "generic"];
const CLIENT_SNIPPETS: Record<ClientId, string[]> = {
  chatgpt: [MCP_ENDPOINT],
  cursor: [json({ mcpServers: { carbon: { url: MCP_ENDPOINT } } })],
  codex: [`[mcp_servers.carbon]\nurl = "${MCP_ENDPOINT}"`],
  vscode: [
    json({ servers: { carbon: { type: "http", url: MCP_ENDPOINT } } }),
    `code --add-mcp '${JSON.stringify({ name: "carbon", type: "http", url: MCP_ENDPOINT })}'`,
  ],
  gemini: [`gemini mcp add --transport http carbon ${MCP_ENDPOINT}`],
  generic: [MCP_ENDPOINT, `npx -y mcp-remote ${MCP_ENDPOINT}`],
};

interface Copy {
  title: string;
  description: string;
  h1: string;
  subtitle: string;
  badges: Tup<string, 4>;
  ui: {
    skip: string;
    endpointLabel: string;
    copy: string;
    copied: string;
    toolsCols: [string, string];
    srcCols: [string, string, string, string];
    licenseUnknown: string;
    sourceStatus: Record<SourceStatus, string>;
    navLabel: string;
    langLabel: string;
    stepsLabel: string;
  };
  headings: Tup<string, 10>;
  problem: string[];
  coverage: Tup<{ title: string; text: string }, 4>;
  coverageNote: string;
  promptsIntro: string;
  prompts: Tup<string, 6>;
  install: { intro: string; steps: Tup<string, 3>; codeLead: string; verify: string };
  clientsIntro: string;
  clients: Record<ClientId, { title: string; text: string }>;
  clientsDisclaimer: string;
  toolsIntro: string;
  toolsMore: string;
  sourcesIntro: string;
  statusParas: string[];
  faq: Tup<{ q: string; a: string }, 7>;
  disclaimer: {
    paras: string[];
    layersTitle: string;
    layers: Tup<{ t: string; d: string }, 3>;
    licenseTitle: string;
    linksTitle: string;
    links: { tools: string; api: string; llms: string; llmsFull: string; github: string };
  };
}

const ZH: Copy = {
  title: "台灣碳排係數 MCP｜讓 AI 查得到台灣官方碳排係數（非官方）",
  description:
    "非官方、免費、公開唯讀的 MCP 服務，讓 AI 查詢台灣政府公開的碳排放係數（電力、自來水、燃料燃燒），計算排放量，並附上資料來源、適用年度與計算依據。",
  h1: "讓 AI 查得到台灣官方碳排係數",
  subtitle: "透過免費、公開的 MCP 服務，讓 AI 直接查詢台灣政府公開的碳排放係數，計算排放量，並附上資料來源、適用年度與計算依據。",
  badges: ["非官方", "免費", "公開唯讀", "不需註冊"],
  ui: {
    skip: "跳到主要內容",
    endpointLabel: "把這個網址貼進 AI 的 MCP 連接器設定：",
    copy: "複製",
    copied: "已複製",
    toolsCols: ["工具", "用途"],
    srcCols: ["提供機關", "資料集", "授權", "匯入狀態"],
    licenseUnknown: "未能在官方頁面確認",
    sourceStatus: { active: "已匯入", pending_key: "透過 API 同步（即時狀態見 /api/v1/status）", pending_verification: "尚未匯入（待查證）" },
    navLabel: "頁面導覽",
    langLabel: "語言",
    stepsLabel: "步驟",
  },
  headings: [
    "這個服務解決什麼問題",
    "可以查詢哪些碳排係數",
    "可以這樣問 AI",
    "一分鐘連接 MCP",
    "支援的 AI 客戶端",
    "MCP 工具列表",
    "官方資料來源",
    "資料更新狀態",
    "常見問題",
    "技術與免責聲明",
  ],
  problem: [
    "AI 被問到碳排係數時，常常憑印象給一個數字：年度不對、單位不對，或根本是編的，而且沒有出處，你無從核對。",
    "碳排放係數散在經濟部能源署、環境部、各自來水公司的網站，格式有 PDF、ODS 與 CSV，同一個名詞在不同來源的邊界與單位也不一樣。",
    "這個服務把這些官方公開資料整理成 AI 可以查詢的形式。AI 查到的每一筆係數，都附上提供機關、適用年度、單位與來源網址；算出來的排放量，附上公式與係數版本。查不到就明說查不到，不會用相近的數字代替。",
  ],
  coverage: [
    {
      title: "電力排碳係數",
      text: "經濟部能源署公布的 2005 至 2025 年度係數。2025 年度起依用途分為三個數值：產業盤查使用 0.466、表燈非營業與包燈用戶 0.471、公用售電業 0.467（公斤CO2e/度）。",
    },
    {
      title: "自來水",
      text: "台灣自來水公司 2007 至 2025 年，單位是 CO2；臺北自來水事業處 2018 至 2025 年，單位是 CO2e。兩者服務區域與邊界不同，不能混用或相加。",
    },
    {
      title: "燃料燃燒",
      text: "環境部 113 年 2 月 5 日公告的溫室氣體排放係數，單位是 kg/TJ，依氣體（CO2、CH4、N2O）分列。官方沒有每公升的係數，計算時必須由你提供燃料的低位熱值。目前只匯入常用燃料。",
    },
    {
      title: "產品碳足跡",
      text: "環境部碳足跡排放係數資料集（CFP_P_02），一千多筆，透過 API 同步。這是產品生命週期碳足跡，不可直接用於組織溫室氣體盤查。以包、瓶、片等件數計的係數，以及官方資料中無法區分的同名紀錄，僅供查詢、不提供計算。",
    },
  ],
  coverageNote: "以上是目前實際收錄的範圍。查詢超出範圍時，服務會回覆查不到，不會推測。",
  promptsIntro: "連接之後，直接用自然語言問。每一句都可以複製：",
  prompts: [
    "2025 年台灣每度電的排碳係數是多少？",
    "幫我計算辦公室一年用電 12,000 度的碳排放量。",
    "台灣政府有沒有公布柴油的排放係數？",
    "幫我查詢塑膠原料的碳足跡係數。",
    "比較不同年度的台灣電力排碳係數。",
    "這筆碳排係數的資料來源與適用範圍是什麼？",
  ],
  install: {
    intro: "以 Claude 網頁版或桌面版為例，不需要寫程式，也不需要 API key。",
    steps: [
      "打開 Settings（設定），進入 Connectors（連接器）。",
      `選「Add custom connector」（新增自訂連接器），網址填入 ${MCP_ENDPOINT}，驗證方式維持不需登入。`,
      "回到對話，在連接器選單裡打開它，然後試著問上面的任何一句。",
    ],
    codeLead: "使用 Claude Code 的話，在終端機執行：",
    verify: "確認成功的方式：回答裡看得到工具呼叫，並且附有資料來源與適用年度。只有一個數字、沒有工具呼叫，代表連接器沒有打開。",
  },
  clientsIntro: "同一個端點，所有支援遠端 MCP（Streamable HTTP）的客戶端都用同一個網址，不需要認證。Claude 與 Claude Code 的設定見上一節。",
  clients: {
    chatgpt: { title: "ChatGPT", text: "需要支援自訂連接器的付費方案，並先在設定裡開啟開發者模式，再用同一個網址新增，驗證方式選不需認證。" },
    cursor: { title: "Cursor", text: "加進專案的 .cursor/mcp.json（或家目錄下的同名檔案）：" },
    codex: { title: "Codex CLI", text: "加進 ~/.codex/config.toml：" },
    vscode: { title: "VS Code", text: "加進專案的 .vscode/mcp.json，或在終端機執行第二行：" },
    gemini: { title: "Gemini CLI", text: "在終端機執行：" },
    generic: { title: "其他 MCP 客戶端", text: "選擇 Streamable HTTP 傳輸，網址如下。只支援 stdio 的客戶端可以用 mcp-remote 橋接（需要 Node.js）：" },
  },
  clientsDisclaimer: "各客戶端的選單位置與方案開放範圍會變動，這裡不保證每一種方案都能使用，請以各客戶端的官方說明為準。",
  toolsIntro: "以下由伺服器實際註冊的工具自動產生。",
  toolsMore: "查看每個工具的參數",
  sourcesIntro: "每一筆係數都來自下列官方資料。本服務只整理與計算，不修改官方數值。",
  statusParas: [
    "各來源的同步狀態是即時的，不寫在這個靜態頁面上。請查詢 /api/v1/status，或請 AI 呼叫 check_factor_updates 工具。",
    "更新方式：電力、自來水與燃料燃燒的資料，來源只有 PDF、ODS 或 CSV 檔，由人工查證數值後匯入，經版本控管審查才會進入資料庫。環境部 CFP_P_02 則透過 API 同步，需要設定 API 金鑰，金鑰設定之前不會有任何資料。",
    "舊版本的係數會保留，過去的計算可以用指定版本重現。",
  ],
  faq: [
    { q: "這是官方服務嗎？", a: "不是。這是 taux.io 提供的非官方服務，與任何政府機關沒有隸屬關係，資料來自各機關公開的資料。" },
    { q: "要付費或註冊嗎？", a: "不用。服務免費、公開、唯讀，不需要註冊帳號，也不需要 API key。" },
    {
      q: "算出來的結果可以用在正式的溫室氣體盤查或查證嗎？",
      a: "不可以。結果僅供參考，不是認證、第三方查證或法令遵循的依據。正式盤查請自行對照官方原始公告，並依你適用的標準與查證單位的要求為準。",
    },
    {
      q: "為什麼算燃料排放量時，AI 會向我要熱值？",
      a: "官方燃料係數的單位是 kg/TJ，以熱量為基礎，官方沒有提供每公升或每公斤的係數，也沒有預設熱值。要換算就必須知道燃料的低位熱值，這個數字要由你（自行檢測或供應商提供）給，本服務不會自行假設。",
    },
    {
      q: "為什麼 2025 年的電力排碳係數有三個？",
      a: "經濟部能源署從 2025 年度起，依用途公布三個數值：產業盤查使用、表燈非營業與包燈用戶、公用售電業整體平均。組織盤查通常用產業盤查使用的那一個，但請依你的情況與適用的規範確認。",
    },
    { q: "查不到係數時會怎麼樣？", a: "服務會明確說明查不到，並盡量列出有資料的年度或相近項目供你參考。它不會編造數字，也不會自動拿其他年度或相似項目代替。" },
    {
      q: "「公告年份」和「適用年度」有什麼不同？",
      a: "適用年度是係數所反映的資料年度，公告年份是官方發布的年份。電力排碳係數通常在適用年度的次年公告，計算時看的是適用年度。",
    },
  ],
  disclaimer: {
    paras: [
      "本服務由 taux.io 提供，是非官方服務，與任何政府機關沒有隸屬關係，也未經其背書。",
      "本服務不提供認證、第三方查證或法令遵循的保證。結果僅供參考，正式使用前請自行對照官方原始公告。",
    ],
    layersTitle: "三種資料要分清楚：",
    layers: [
      { t: "政府原始資料", d: "機關公布的原始數值與單位，本服務不修改。" },
      { t: "本服務整理的資料", d: "別名、分類、使用限制與說明，由本服務整理，不是官方文字。" },
      { t: "本服務計算的結果", d: "活動數據乘以係數的運算結果，由本服務的程式計算，不是官方數字。" },
    ],
    licenseTitle: "授權與出處",
    linksTitle: "相關連結",
    links: { tools: "MCP 工具參考", api: "REST API 文件", llms: "llms.txt", llmsFull: "llms-full.txt", github: "GitHub 原始碼" },
  },
};

const EN: Copy = {
  title: "Taiwan Carbon Open Data | Taiwan's official emission factors for AI (unofficial)",
  description:
    "A free, public, read-only MCP service that lets AI look up Taiwan government emission factors (electricity, tap water, fuel combustion) and calculate emissions with the source, applicable year and method shown.",
  h1: "Let AI look up Taiwan's official emission factors",
  subtitle:
    "A free, public MCP service that lets AI query the emission factors published by Taiwan's government, calculate emissions, and show the source, applicable year and calculation basis.",
  badges: ["Unofficial", "Free", "Public, read-only", "No sign-up"],
  ui: {
    skip: "Skip to main content",
    endpointLabel: "Paste this URL into your AI client's MCP connector settings:",
    copy: "Copy",
    copied: "Copied",
    toolsCols: ["Tool", "What it does"],
    srcCols: ["Organization", "Dataset", "Licence", "Import status"],
    licenseUnknown: "Not confirmed on the official page",
    sourceStatus: { active: "Imported", pending_key: "Synced by API (live status at /api/v1/status)", pending_verification: "Not yet imported (pending verification)" },
    navLabel: "Page navigation",
    langLabel: "Language",
    stepsLabel: "Steps",
  },
  headings: [
    "What problem this solves",
    "Which emission factors are covered",
    "What you can ask the AI",
    "Connect MCP in a minute",
    "Supported AI clients",
    "MCP tools",
    "Official data sources",
    "Data update status",
    "FAQ",
    "Technical notes and disclaimer",
  ],
  problem: [
    "Asked for an emission factor, an AI often gives a number from memory: the wrong year, the wrong unit, or simply invented, with no source you can check.",
    "Taiwan's emission factors are spread across the Energy Administration, the Ministry of Environment and the water utilities, in PDF, ODS and CSV, and the same term can mean a different boundary or unit from one source to the next.",
    "This service organizes those official public data so an AI can query them. Every factor it returns carries the publishing organization, applicable year, unit and source URL; every calculation carries its formula and the factor version. If a factor is not found, it says so instead of substituting a nearby number.",
  ],
  coverage: [
    {
      title: "Electricity",
      text: "Factors from the Energy Administration, Ministry of Economic Affairs, for 2005 to 2025. From the 2025 factor year there are three values by usage: 0.466 for industry inventory, 0.471 for non-commercial lighting and flat-rate lighting customers, and 0.467 for the public utility average (kgCO2e/kWh).",
    },
    {
      title: "Tap water",
      text: "Taiwan Water Corporation, 2007 to 2025, expressed in CO2; Taipei Water Department, 2018 to 2025, expressed in CO2e. The service areas and boundaries differ, so the two must not be mixed or added.",
    },
    {
      title: "Fuel combustion",
      text: "Greenhouse gas emission factors announced by the Ministry of Environment on 5 February 2024 (ROC year 113), in kg/TJ and split by gas (CO2, CH4, N2O). There is no official per-litre factor, so you must supply the fuel's lower heating value. Only common fuels are imported so far.",
    },
    {
      title: "Product carbon footprint",
      text: "The Ministry of Environment's carbon footprint factor dataset (CFP_P_02), over a thousand records, synced by API. These are product life-cycle footprints and must not be used directly for an organisational GHG inventory. Factors declared per item (pack, bottle, sheet) and same-name records the official data does not tell apart are lookup-only, not calculable.",
    },
  ],
  coverageNote: "This is what is actually imported today. For anything outside it, the service answers that nothing was found rather than guessing.",
  promptsIntro: "Once connected, just ask in plain language. Each prompt can be copied:",
  prompts: [
    "What is Taiwan's electricity emission factor per kWh for 2025?",
    "Calculate the emissions of an office that uses 12,000 kWh of electricity a year.",
    "Has the Taiwan government published an emission factor for diesel?",
    "Look up the carbon footprint factor for plastic raw material.",
    "Compare Taiwan's electricity emission factors across different years.",
    "What are the source and scope of application of this emission factor?",
  ],
  install: {
    intro: "Using Claude on the web or desktop as the example. No coding and no API key.",
    steps: [
      "Open Settings and go to Connectors.",
      `Choose "Add custom connector", enter ${MCP_ENDPOINT} as the URL, and leave authentication off.`,
      "Back in a conversation, switch the connector on from the connector menu, then try any prompt above.",
    ],
    codeLead: "With Claude Code, run this in a terminal:",
    verify: "To confirm it works, look for a tool call in the answer, with the source and applicable year shown. A bare number with no tool call means the connector is not switched on.",
  },
  clientsIntro: "One endpoint for every client that supports remote MCP (Streamable HTTP); no authentication. Claude and Claude Code are covered in the previous section.",
  clients: {
    chatgpt: { title: "ChatGPT", text: "Needs a paid plan that supports custom connectors, with developer mode switched on in settings first. Add the same URL and choose no authentication." },
    cursor: { title: "Cursor", text: "Add to .cursor/mcp.json in the project (or the file of the same name in your home directory):" },
    codex: { title: "Codex CLI", text: "Add to ~/.codex/config.toml:" },
    vscode: { title: "VS Code", text: "Add to .vscode/mcp.json in the project, or run the second line in a terminal:" },
    gemini: { title: "Gemini CLI", text: "Run in a terminal:" },
    generic: { title: "Any other MCP client", text: "Choose the Streamable HTTP transport with the URL below. Clients that only support stdio can bridge with mcp-remote (needs Node.js):" },
  },
  clientsDisclaimer:
    "Client menus and plan availability change, and are not guaranteed here. We do not promise that every plan works; follow each client's official documentation.",
  toolsIntro: "Generated from the tools the server actually registers.",
  toolsMore: "See every tool's parameters",
  sourcesIntro: "Every factor comes from the official data below. This service organizes and calculates; it does not alter official values.",
  statusParas: [
    "Sync status is live and is not written on this static page. Query /api/v1/status, or ask the AI to call the check_factor_updates tool.",
    "How each source is updated: electricity, water and fuel combustion data exist only as PDF, ODS or CSV files, so a person checks the values and imports them, and they reach the database only after review in version control. CFP_P_02 from the Ministry of Environment is synced through its API, which needs an API key; until a key is configured it holds no data.",
    "Older factor versions are kept, so a past calculation can be reproduced by naming the version.",
  ],
  faq: [
    { q: "Is this an official service?", a: "No. It is an unofficial service by taux.io, not affiliated with any government agency. The data comes from what each agency publishes." },
    { q: "Does it cost anything or need sign-up?", a: "No. It is free, public and read-only, with no account and no API key." },
    {
      q: "Can the results be used for a certified GHG inventory or verification?",
      a: "No. Results are for reference only and are not a basis for certification, third-party verification or legal compliance. For a formal inventory, check the original official announcements and follow the standard and verifier that apply to you.",
    },
    {
      q: "Why does a fuel calculation ask me for a heating value?",
      a: "Official fuel factors are in kg/TJ, based on energy content. There is no official per-litre or per-kilogram factor and no default heating value. Converting needs the fuel's lower heating value, which you provide (measured or from your supplier). The service never assumes one.",
    },
    {
      q: "Why are there three electricity factors for 2025?",
      a: "From the 2025 factor year the Energy Administration publishes three values by usage: for industry inventory, for non-commercial lighting and flat-rate lighting customers, and the public utility average. Organizations usually use the industry inventory value, but confirm against your own situation and the rules that apply.",
    },
    { q: "What happens when a factor is not found?", a: "The service says plainly that it found nothing and, where it can, lists the years or nearby items that do exist. It never invents a number or silently substitutes another year or a similar item." },
    {
      q: "What is the difference between publication year and applicable year?",
      a: "The applicable year is the data year a factor reflects; the publication year is when it was announced. Electricity factors are usually announced the year after the year they apply to. Calculations use the applicable year.",
    },
  ],
  disclaimer: {
    paras: [
      "This service is provided by taux.io. It is unofficial, not affiliated with or endorsed by any government agency.",
      "It offers no certification, third-party verification or guarantee of legal compliance. Results are for reference; check the original official announcements before any formal use.",
    ],
    layersTitle: "Keep three kinds of data apart:",
    layers: [
      { t: "Government source data", d: "The original values and units as published by the agency. This service does not change them." },
      { t: "Data curated by this service", d: "Aliases, categories, usage limits and notes written by this service; not official text." },
      { t: "Results calculated by this service", d: "Activity data multiplied by a factor, computed by this service's code; not an official figure." },
    ],
    licenseTitle: "Licence and attribution",
    linksTitle: "Related links",
    links: { tools: "MCP tool reference", api: "REST API docs", llms: "llms.txt", llmsFull: "llms-full.txt", github: "Source code on GitHub" },
  },
};

const JA: Copy = {
  title: "Taiwan Carbon Open Data｜台湾の公式排出係数をAIが調べられる（非公式）",
  description:
    "台湾政府が公開する排出係数（電力・水道水・燃料の燃焼）をAIが検索し、出典・適用年度・計算根拠つきで排出量を計算できる、無料・公開・読み取り専用のMCPサービスです。",
  h1: "AIが台湾の公式排出係数を調べられるように",
  subtitle:
    "無料で公開されているMCPサービスを通じて、AIが台湾政府の公開する排出係数を直接検索し、排出量を計算します。出典、適用年度、計算の根拠を必ず添えます。",
  badges: ["非公式", "無料", "公開・読み取り専用", "登録不要"],
  ui: {
    skip: "本文へ移動",
    endpointLabel: "このURLをAIクライアントのMCPコネクタ設定に貼り付けます。",
    copy: "コピー",
    copied: "コピーしました",
    toolsCols: ["ツール", "用途"],
    srcCols: ["提供機関", "データセット", "ライセンス", "取り込み状況"],
    licenseUnknown: "公式ページでは確認できていません",
    sourceStatus: { active: "取り込み済み", pending_key: "APIで同期（最新の状態は /api/v1/status）", pending_verification: "未取り込み（確認待ち）" },
    navLabel: "ページ内ナビゲーション",
    langLabel: "言語",
    stepsLabel: "手順",
  },
  headings: [
    "このサービスが解決すること",
    "調べられる排出係数",
    "AIにこう聞けます",
    "1分でMCPに接続",
    "対応するAIクライアント",
    "MCPツール一覧",
    "公式データソース",
    "データの更新状況",
    "よくある質問",
    "技術情報と免責事項",
  ],
  problem: [
    "排出係数をAIに尋ねると、記憶に頼った数字が返ってくることがあります。年度や単位が違ったり、作り話だったりして、出典も確認できません。",
    "台湾の排出係数は、経済部エネルギー署、環境部、各水道事業者のサイトに分かれ、形式もPDF、ODS、CSVとさまざまです。同じ用語でも、出典によって境界や単位が異なります。",
    "このサービスは、それらの公式な公開データをAIが検索できる形に整えます。返す係数には提供機関、適用年度、単位、出典URLを添え、計算結果には計算式と係数のバージョンを添えます。見つからないときは、近い数字で代用せず、見つからないと答えます。",
  ],
  coverage: [
    {
      title: "電力の排出係数",
      text: "経済部エネルギー署が公表する2005年から2025年までの係数です。2025年度からは用途別に3つの値があります。産業のインベントリ用0.466、電灯（非営業）・定額電灯の需要家向け0.471、公共電力事業者の平均0.467（kgCO2e/kWh）です。",
    },
    {
      title: "水道水",
      text: "台湾自来水公司の2007年から2025年まではCO2、台北自来水事業処の2018年から2025年まではCO2e表記です。給水区域と算定境界が異なるため、混ぜたり合算したりできません。",
    },
    {
      title: "燃料の燃焼",
      text: "環境部が2024年2月5日（民国113年）に公告した温室効果ガス排出係数です。単位はkg/TJで、ガス（CO2、CH4、N2O）ごとに分かれています。公式にはリットル当たりの係数がないため、燃料の低位発熱量をご自身で指定する必要があります。取り込み済みなのは、一般的な燃料のみです。",
    },
    {
      title: "製品のカーボンフットプリント",
      text: "環境部のカーボンフットプリント係数データセット（CFP_P_02）、千件あまりをAPIで同期しています。製品のライフサイクル全体の値であり、組織の温室効果ガス算定にそのまま使うことはできません。包・本・枚など個数単位の係数と、公式データ上で区別できない同名の記録は、参照のみで計算には使えません。",
    },
  ],
  coverageNote: "ここに書いたのが、現在実際に取り込んでいる範囲です。範囲外の質問には、推測せず見つからないと答えます。",
  promptsIntro: "接続したら、そのまま日本語や中国語で聞けます。各文はコピーできます。",
  prompts: [
    "2025年の台湾の電力1kWh当たりの排出係数はいくつですか。",
    "オフィスで年間12,000kWhの電力を使った場合の排出量を計算してください。",
    "台湾政府は軽油の排出係数を公表していますか。",
    "プラスチック原料のカーボンフットプリント係数を調べてください。",
    "台湾の電力排出係数を年度ごとに比較してください。",
    "この排出係数の出典と適用範囲を教えてください。",
  ],
  install: {
    intro: "例としてClaudeのウェブ版・デスクトップ版を使います。プログラミングもAPIキーも不要です。",
    steps: [
      "設定（Settings）を開き、コネクタ（Connectors）に進みます。",
      `「カスタムコネクタを追加」を選び、URLに ${MCP_ENDPOINT} を入力します。認証は設定しません。`,
      "会話に戻り、コネクタのメニューでオンにして、上のどれかを聞いてみます。",
    ],
    codeLead: "Claude Codeを使う場合は、ターミナルで次を実行します。",
    verify: "うまくいったかは、回答にツール呼び出しがあり、出典と適用年度が示されているかで確認できます。数字だけでツール呼び出しがない場合は、コネクタがオンになっていません。",
  },
  clientsIntro: "リモートMCP（Streamable HTTP）に対応するクライアントなら、どれも同じエンドポイントで、認証は不要です。ClaudeとClaude Codeは前の節をご覧ください。",
  clients: {
    chatgpt: { title: "ChatGPT", text: "カスタムコネクタに対応した有料プランが必要で、先に設定で開発者モードをオンにします。同じURLを追加し、認証は「なし」を選びます。" },
    cursor: { title: "Cursor", text: "プロジェクトの .cursor/mcp.json（またはホームディレクトリの同名ファイル）に追加します。" },
    codex: { title: "Codex CLI", text: "~/.codex/config.toml に追加します。" },
    vscode: { title: "VS Code", text: "プロジェクトの .vscode/mcp.json に追加するか、2行目をターミナルで実行します。" },
    gemini: { title: "Gemini CLI", text: "ターミナルで次を実行します。" },
    generic: { title: "その他のMCPクライアント", text: "Streamable HTTPを選び、次のURLを指定します。stdioにしか対応しないクライアントは、mcp-remoteで橋渡しできます（Node.jsが必要です）。" },
  },
  clientsDisclaimer:
    "クライアントのメニュー位置や利用できるプランは変わることがあり、ここでは保証しません。すべてのプランで使えるとはお約束できませんので、各クライアントの公式ドキュメントをご確認ください。",
  toolsIntro: "サーバーが実際に登録しているツールから自動生成しています。",
  toolsMore: "各ツールの引数を見る",
  sourcesIntro: "すべての係数は、次の公式データに由来します。このサービスは整理と計算だけを行い、公式の数値は変更しません。",
  statusParas: [
    "同期状況はリアルタイムで確認するもので、この静的ページには書いていません。/api/v1/status を参照するか、AIにcheck_factor_updatesツールを呼び出させてください。",
    "更新方法は次のとおりです。電力・水道水・燃料の燃焼のデータはPDF、ODS、CSVとしてしか公開されていないため、人が数値を確認して取り込み、バージョン管理でのレビューを経てからデータベースに入ります。環境部のCFP_P_02はAPIで同期しますが、APIキーが必要で、キーを設定するまでデータはありません。",
    "古いバージョンの係数も保持しており、バージョンを指定すれば過去の計算を再現できます。",
  ],
  faq: [
    { q: "公式のサービスですか。", a: "いいえ。taux.ioが提供する非公式のサービスで、いかなる政府機関とも関係はありません。データは各機関の公開情報に基づきます。" },
    { q: "料金や登録は必要ですか。", a: "不要です。無料・公開・読み取り専用で、アカウント登録もAPIキーも要りません。" },
    {
      q: "計算結果を、認証付きのGHGインベントリや第三者検証に使えますか。",
      a: "使えません。結果は参考情報であり、認証、第三者検証、法令遵守の根拠にはなりません。正式なインベントリでは、公式の原文を確認し、適用される基準と検証機関の要求に従ってください。",
    },
    {
      q: "燃料の計算で、なぜ発熱量を聞かれるのですか。",
      a: "公式の燃料係数はkg/TJで、熱量を基準にしています。リットル当たり・キログラム当たりの公式係数も、既定の発熱量もありません。換算には燃料の低位発熱量が必要で、これはご自身（実測または供給者の値）で指定します。このサービスが仮定することはありません。",
    },
    {
      q: "2025年の電力係数が3つあるのはなぜですか。",
      a: "エネルギー署は2025年度から、用途別に3つの値を公表しています。産業のインベントリ用、電灯（非営業）・定額電灯の需要家向け、公共電力事業者の平均です。組織のインベントリでは通常、産業のインベントリ用を使いますが、ご自身の状況と適用される規則で確認してください。",
    },
    { q: "係数が見つからないときはどうなりますか。", a: "見つからなかったとはっきり伝え、可能な範囲で存在する年度や近い項目を示します。数字を作ったり、別の年度や似た項目で黙って代用したりはしません。" },
    {
      q: "「公表年」と「適用年度」は何が違いますか。",
      a: "適用年度は係数が反映するデータの年度、公表年は公式に発表された年です。電力の排出係数は通常、適用年度の翌年に公表されます。計算では適用年度を見ます。",
    },
  ],
  disclaimer: {
    paras: [
      "このサービスはtaux.ioが提供する非公式のサービスで、いかなる政府機関とも関係はなく、承認も受けていません。",
      "認証、第三者検証、法令遵守の保証はありません。結果は参考情報です。正式に使う前に、公式の原文をご確認ください。",
    ],
    layersTitle: "次の3種類のデータを区別してください。",
    layers: [
      { t: "政府の原データ", d: "機関が公表した元の数値と単位です。このサービスは変更しません。" },
      { t: "本サービスが整理したデータ", d: "別名、分類、利用上の制約、説明です。本サービスが書いたもので、公式の文言ではありません。" },
      { t: "本サービスが計算した結果", d: "活動量に係数を掛けた結果で、本サービスのプログラムが計算したものです。公式の数値ではありません。" },
    ],
    licenseTitle: "ライセンスと出典表示",
    linksTitle: "関連リンク",
    links: { tools: "MCPツールリファレンス", api: "REST APIドキュメント", llms: "llms.txt", llmsFull: "llms-full.txt", github: "GitHubのソースコード" },
  },
};

const COPY: Record<Locale, Copy> = { zh: ZH, en: EN, ja: JA };

/** 沿用 twse-mcp 的色彩代幣與版型，去掉動畫與裝飾性背景。 */
const CSS = `
:root{color-scheme:light dark;--bg:#fafaf8;--surface:#fff;--text:#14161a;--muted:#596270;--line:#e2e5e8;--accent:#2f5d8a;--accent-ink:#fff;--soft:#eef3f8;--code:#f3f4f5;--warn:#8a5a00;--r:12px}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--surface:#16191d;--text:#eceef0;--muted:#98a1ac;--line:#262b31;--accent:#8ab6e2;--accent-ink:#0e1013;--soft:#18222e;--code:#1b1f24;--warn:#e0b45c}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:5rem}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.8 system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;word-break:break-word;text-wrap:pretty}
html:lang(ja) body{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif}
a{color:var(--accent);text-underline-offset:.2em}
a:focus-visible,summary:focus-visible,.copy:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.skip{position:absolute;left:-999px;top:.5rem;background:var(--surface);padding:.4rem .8rem;border-radius:6px;z-index:20}
.skip:focus{left:.5rem}
.wide{max-width:64rem;margin:0 auto;padding:0 1.25rem}
.top{border-bottom:1px solid var(--line);background:var(--bg)}
.top .wide{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;min-height:3.5rem;padding-top:.4rem;padding-bottom:.4rem}
.brand{font-weight:700;color:var(--text);text-decoration:none}
.nav{display:flex;gap:1rem;flex-wrap:wrap;margin-left:auto;font-size:.9rem}
.nav a{color:var(--muted)}
.switch{display:flex;gap:.4rem;font-size:.85rem}
.switch a,.switch span{border:1px solid var(--line);border-radius:999px;padding:.1rem .7rem;color:var(--muted);text-decoration:none;background:var(--surface)}
.switch span{color:var(--text);border-color:var(--accent)}
main{padding-bottom:3rem}
.hero{padding:clamp(2.5rem,6vw,4.5rem) 0 2rem;border-bottom:1px solid var(--line)}
h1{font-size:clamp(1.9rem,5vw,3rem);line-height:1.2;margin:0 0 1rem;letter-spacing:-.02em;text-wrap:balance}
.lede{font-size:1.1rem;color:var(--muted);max-width:42rem;margin:0 0 1.5rem}
.badges{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0;margin:0 0 1.5rem}
.badges li{margin:0;border:1px solid var(--line);background:var(--soft);border-radius:999px;padding:.1rem .8rem;font-size:.85rem}
.endpoint-label{margin:0 0 .4rem;font-size:.85rem;font-weight:600;color:var(--muted)}
section{margin-top:3rem}
section>*,.wrap-narrow>*{max-width:46rem}
section>.tbl,section>.copyable.wideblock{max-width:none}
h2{font-size:1.5rem;line-height:1.3;margin:0 0 1rem;letter-spacing:-.01em;text-wrap:balance}
main{counter-reset:sec}
section>h2{counter-increment:sec}
section>h2::before{content:counter(sec) ". ";color:var(--accent);font-variant-numeric:tabular-nums}
h3{font-size:1.05rem;margin:1.6rem 0 .3rem}
p,li{margin:.6rem 0}
ul,ol{padding-left:1.3rem}
code{background:var(--code);padding:.1em .35em;border-radius:5px;font-size:.9em}
pre{background:var(--code);border:1px solid var(--line);border-radius:var(--r);padding:.8rem 1rem;overflow-x:auto;margin:.6rem 0}
pre code{background:none;padding:0;-webkit-user-select:all;user-select:all}
.copyable{position:relative}
.copyable pre{padding-right:3rem;white-space:pre-wrap;overflow-wrap:anywhere}
.copy{position:absolute;top:.4rem;right:.4rem;display:flex;align-items:center;justify-content:center;gap:.4rem;min-width:2rem;height:2rem;padding:0 .4rem;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:.85rem}
.copy:hover,.copy:focus-visible{border-color:var(--line);background:var(--surface);color:var(--accent)}
.copy[hidden]{display:none}
.copy .i-done,.copy.done .i-copy,.copy .t-done,.copy.done .t-copy{display:none}
.copy.done .i-done{display:block;color:var(--accent)}
.copy.done .t-done{display:inline}
.endpoint{border-color:var(--accent);background:var(--soft);font-size:1.05rem;padding-right:7.5rem;min-height:3.4rem;display:flex;align-items:center;margin:0}
.endpoint+.copy{height:2.6rem;top:.4rem;right:.4rem;padding:0 .9rem;background:var(--accent);color:var(--accent-ink);font-weight:700}
.endpoint+.copy:hover,.endpoint+.copy:focus-visible{background:var(--accent);color:var(--accent-ink)}
.endpoint+.copy.done .i-done{color:var(--accent-ink)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.prompts{list-style:none;padding:0}
.prompts li{margin:.5rem 0}
.prompts pre{margin:0}
.cov{list-style:none;padding:0}
.cov li{border:1px solid var(--line);background:var(--surface);border-radius:var(--r);padding:.8rem 1.1rem;margin:.7rem 0}
.cov li.pending{border-style:dashed}
.cov strong{display:block}
.note{border:1px solid var(--line);background:var(--soft);padding:.2rem 1rem;margin:1.2rem 0;border-radius:var(--r)}
.tbl{overflow-x:auto;margin:1rem 0;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border-bottom:1px solid var(--line);padding:.6rem .85rem;text-align:left;vertical-align:top}
tr:last-child td{border-bottom:0}
th{font-weight:600;color:var(--muted);font-size:.8rem;background:var(--code)}
td code{white-space:nowrap}
.tag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 .6rem;font-size:.8rem;background:var(--soft)}
.tag.pending{color:var(--warn);border-color:var(--warn);background:transparent}
details{border-bottom:1px solid var(--line)}
details:first-of-type{border-top:1px solid var(--line)}
summary{cursor:pointer;padding:.9rem 2rem .9rem 0;font-weight:600;list-style:none;position:relative}
summary::-webkit-details-marker{display:none}
summary::after{content:"";position:absolute;right:.3rem;top:50%;width:.55rem;height:.55rem;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-70%) rotate(45deg)}
details[open]>summary::after{transform:translateY(-30%) rotate(-135deg)}
details>p,details>div{margin:0 0 1rem;color:var(--muted)}
.client{margin-bottom:1.4rem}
footer{border-top:1px solid var(--line);padding:1.5rem 0 3rem;color:var(--muted);font-size:.9rem}
footer p{margin:.4rem 0}
.attr{font-size:.88rem}
.doc h1{font-size:clamp(1.7rem,4vw,2.3rem)}
.doc h2{margin-top:2.5rem}
.doc h2::before{content:none}
.doc section>h2::before{content:none}
.method{font-weight:700;font-variant-numeric:tabular-nums}
@media (max-width:36rem){.wide{padding-left:1rem;padding-right:1rem}.endpoint{padding-right:6.5rem;font-size:.95rem}.nav{margin-left:0;width:100%}}
`.trim();

const ICON_COPY =
  '<svg class="i-copy" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const ICON_DONE =
  '<svg class="i-done" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

interface CopyLabels {
  copy: string;
  copied: string;
}

/** 可複製的程式碼區塊。語系文字只放在 HTML 屬性裡，腳本本身不含任何語系文字。 */
function copyable(l: CopyLabels, code: string, kind = ""): string {
  const label = esc(l.copy);
  const done = esc(l.copied);
  const text = kind === "endpoint" ? `<span class="t-copy">${label}</span><span class="t-done">${done}</span>` : "";
  const cls = kind === "prompt" ? "copyable prompt" : "copyable";
  return (
    `<div class="${cls}"><pre${kind === "endpoint" ? ' class="endpoint"' : ""}><code>${esc(code)}</code></pre>` +
    `<button type="button" class="copy" aria-label="${label}" title="${label}" data-done="${done}" hidden>${ICON_COPY}${ICON_DONE}${text}</button>` +
    `<span class="sr" role="status"></span></div>`
  );
}

const ZH_LABELS: CopyLabels = { copy: ZH.ui.copy, copied: ZH.ui.copied };
const hreflangLinks = (): string =>
  LOCALE_KEYS.map((l) => `<link rel="alternate" hreflang="${LOCALES[l].hreflang}" href="${SITE_ORIGIN}${LOCALES[l].path}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/">`)
    .join("\n");

interface ShellOpts {
  lang: string;
  title: string;
  description: string;
  canonical: string;
  ogLocale: string;
  head?: string;
  nav: string;
  switcher: string;
  brandHref: string;
  skip: string;
  body: string;
  footer: string;
}

function shell(o: ShellOpts): string {
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${o.canonical}">
${o.head ?? ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${o.canonical}">
<meta property="og:locale" content="${o.ogLocale}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
<meta name="robots" content="index,follow">
<link rel="alternate" type="text/plain" href="${SITE_ORIGIN}/llms.txt" title="llms.txt">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">${esc(o.skip)}</a>
<header class="top"><div class="wide">
<a class="brand" href="${o.brandHref}">${SITE_NAME}</a>
${o.nav}
${o.switcher}
</div></header>
<main id="main">
${o.body}
</main>
<footer><div class="wide">
${o.footer}
</div></footer>
<script>${COPY_SCRIPT}</script>
</body>
</html>
`;
}

interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
};

function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map(String).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
  if (Array.isArray(s.type)) return s.type.join(" | ");
  return s.type ?? "any";
}

function flatten(s: JsonSchema, prefix: string, depth: number, out: ParamRow[]): void {
  const req = new Set(s.required ?? []);
  for (const [name, p] of Object.entries(s.properties ?? {})) {
    out.push({ name: prefix + name, type: typeOf(p), required: req.has(name), description: p.description ?? "" });
    if (depth < 4) {
      if (p.properties) flatten(p, `${prefix}${name}.`, depth + 1, out);
      else if (p.items?.properties) flatten(p.items, `${prefix}${name}[].`, depth + 1, out);
    }
  }
}

function paramRows(shape: z.ZodRawShape): ParamRow[] {
  const rows: ParamRow[] = [];
  flatten(z.toJSONSchema(z.object(shape), { io: "input" }) as JsonSchema, "", 0, rows);
  return rows;
}

const TOOL_PARAMS = new Map(TOOLS.map((t) => [t.name, paramRows(t.shape)]));

const OGDL_NAME = "政府資料開放授權條款－第1版";

function ldSoftware(loc: Locale, c: Copy) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `${SITE_NAME} (Unofficial)`,
    alternateName: ["台灣碳排係數 MCP", SERVICE_NAME],
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Model Context Protocol Server",
    operatingSystem: "Any",
    url: SITE_ORIGIN + LOCALES[loc].path,
    description: c.description,
    softwareVersion: VERSION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
    isAccessibleForFree: true,
    codeRepository: REPO,
    inLanguage: LOCALES[loc].lang,
    featureList: TOOLS.map((t) => t.summary[loc]),
  };
}

function ldFaq(c: Copy) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

function sourcesTable(c: Copy): string {
  const rows = SOURCES.map((s) => {
    const pending = s.status !== "active";
    return (
      `<tr><td>${esc(s.organization)}</td>` +
      `<td><a href="${esc(s.official_url)}">${esc(s.dataset_name)}</a>${s.dataset_code ? ` <code>${esc(s.dataset_code)}</code>` : ""}</td>` +
      `<td>${s.license ? esc(s.license) : esc(c.ui.licenseUnknown)}</td>` +
      `<td><span class="tag${pending ? " pending" : ""}">${esc(c.ui.sourceStatus[s.status])}</span></td></tr>`
    );
  }).join("\n");
  return `<div class="tbl"><table>
<thead><tr>${c.ui.srcCols.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function toolsTable(loc: Locale, c: Copy): string {
  const rows = TOOLS.map((t) => `<tr><td><code>${esc(t.name)}</code></td><td>${esc(t.summary[loc])}</td></tr>`).join("\n");
  return `<div class="tbl"><table>
<thead><tr>${c.ui.toolsCols.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function clientHtml(l: CopyLabels, c: Copy, id: ClientId): string {
  const cl = c.clients[id];
  const blocks = CLIENT_SNIPPETS[id].map((s) => copyable(l, s)).join("\n");
  return `<div class="client"><h3>${esc(cl.title)}</h3><p>${esc(cl.text)}</p>${blocks}</div>`;
}

function homeSections(loc: Locale, c: Copy): string[] {
  const l: CopyLabels = c.ui;
  const h = c.headings;
  return [
    `<h2 id="problem">${esc(h[0])}</h2>\n${c.problem.map((p) => `<p>${esc(p)}</p>`).join("\n")}`,
    `<h2 id="coverage">${esc(h[1])}</h2>
<ul class="cov">
${c.coverage.map((x, i) => `<li${i === 3 ? ' class="pending"' : ""}><strong>${esc(x.title)}</strong>${esc(x.text)}</li>`).join("\n")}
</ul>
<p>${esc(c.coverageNote)}</p>`,
    `<h2 id="prompts">${esc(h[2])}</h2>
<p>${esc(c.promptsIntro)}</p>
<ul class="prompts">
${c.prompts.map((p) => `<li>${copyable(l, p, "prompt")}</li>`).join("\n")}
</ul>`,
    `<h2 id="install">${esc(h[3])}</h2>
<p>${esc(c.install.intro)}</p>
<ol aria-label="${esc(c.ui.stepsLabel)}">
${c.install.steps.map((s) => `<li>${esc(s)}</li>`).join("\n")}
</ol>
${copyable(l, MCP_ENDPOINT)}
<p>${esc(c.install.codeLead)}</p>
${copyable(l, CLAUDE_CODE_CMD)}
<p>${esc(c.install.verify)}</p>`,
    `<h2 id="clients">${esc(h[4])}</h2>
<p>${esc(c.clientsIntro)}</p>
${CLIENT_ORDER.map((id) => clientHtml(l, c, id)).join("\n")}
<div class="note"><p>${esc(c.clientsDisclaimer)}</p></div>`,
    `<h2 id="tools">${esc(h[5])}</h2>
<p>${esc(c.toolsIntro)}</p>
<p><a href="/tools">${esc(c.toolsMore)}</a></p>
${toolsTable(loc, c)}`,
    `<h2 id="sources">${esc(h[6])}</h2>
<p>${esc(c.sourcesIntro)}</p>
${sourcesTable(c)}`,
    `<h2 id="status">${esc(h[7])}</h2>\n${c.statusParas.map((p) => `<p>${esc(p)}</p>`).join("\n")}`,
    `<h2 id="faq">${esc(h[8])}</h2>\n${c.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}`,
    `<h2 id="disclaimer">${esc(h[9])}</h2>
${c.disclaimer.paras.map((p) => `<p>${esc(p)}</p>`).join("\n")}
<p>${esc(c.disclaimer.layersTitle)}</p>
<ul>
${c.disclaimer.layers.map((x) => `<li><strong>${esc(x.t)}</strong>${loc === "en" ? ": " : "："}${esc(x.d)}</li>`).join("\n")}
</ul>
<h3>${esc(c.disclaimer.licenseTitle)}</h3>
<p class="attr">${esc(ATTRIBUTION)}</p>
<p class="attr"><a href="${LICENSE_URL}">${OGDL_NAME}</a>: <a href="${LICENSE_URL}">${LICENSE_URL}</a></p>
<h3>${esc(c.disclaimer.linksTitle)}</h3>
<ul>
<li><a href="/tools">${esc(c.disclaimer.links.tools)}</a></li>
<li><a href="/api/docs">${esc(c.disclaimer.links.api)}</a></li>
<li><a href="/llms.txt">${esc(c.disclaimer.links.llms)}</a></li>
<li><a href="/llms-full.txt">${esc(c.disclaimer.links.llmsFull)}</a></li>
<li><a href="${REPO}">${esc(c.disclaimer.links.github)}</a></li>
</ul>`,
  ];
}

function switcherHtml(current: Locale | null, label: string): string {
  const items = LOCALE_KEYS.map((k) => {
    const o = LOCALES[k];
    return k === current
      ? `<span lang="${o.lang}" aria-current="page">${esc(o.label)}</span>`
      : `<a href="${o.path}" hreflang="${o.hreflang}" lang="${o.lang}">${esc(o.label)}</a>`;
  }).join("");
  return `<div class="switch" role="group" aria-label="${esc(label)}">${items}</div>`;
}

export function renderPage(locale: Locale): string {
  const c = COPY[locale];
  const me = LOCALES[locale];
  const canonical = `${SITE_ORIGIN}${me.path}`;
  const nav = `<nav class="nav" aria-label="${esc(c.ui.navLabel)}"><a href="#install">${esc(c.headings[3])}</a><a href="#tools">${esc(c.headings[5])}</a><a href="#faq">${esc(c.headings[8])}</a></nav>`;
  const hero = `<div class="hero"><div class="wide">
<h1>${esc(c.h1)}</h1>
<p class="lede">${esc(c.subtitle)}</p>
<ul class="badges">${c.badges.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
<p class="endpoint-label">${esc(c.ui.endpointLabel)}</p>
${copyable(c.ui, MCP_ENDPOINT, "endpoint")}
</div></div>`;
  const sections = homeSections(locale, c)
    .map((s) => `<section>\n${s}\n</section>`)
    .join("\n");
  const footer = `<p>${esc(c.disclaimer.paras[0] ?? "")}</p>
<p><a href="/tools">${esc(c.disclaimer.links.tools)}</a> · <a href="/api/docs">${esc(c.disclaimer.links.api)}</a> · <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="${REPO}">GitHub</a></p>`;
  return shell({
    lang: me.lang,
    title: c.title,
    description: c.description,
    canonical,
    ogLocale: me.ogLocale,
    head:
      `${hreflangLinks()}\n` +
      `<script type="application/ld+json">${jsonForScript(ldSoftware(locale, c))}</script>\n` +
      `<script type="application/ld+json">${jsonForScript(ldFaq(c))}</script>`,
    nav,
    switcher: switcherHtml(locale, c.ui.langLabel),
    brandHref: me.path,
    skip: c.ui.skip,
    body: `${hero}\n<div class="wide">\n${sections}\n</div>`,
    footer,
  });
}

function docShell(path: string, title: string, description: string, body: string): string {
  return shell({
    lang: LOCALES.zh.lang,
    title,
    description,
    canonical: `${SITE_ORIGIN}${path}`,
    ogLocale: LOCALES.zh.ogLocale,
    nav: `<nav class="nav" aria-label="${esc(ZH.ui.navLabel)}"><a href="/tools">MCP 工具</a><a href="/api/docs">REST API</a><a href="/llms.txt">llms.txt</a></nav>`,
    switcher: "",
    brandHref: "/",
    skip: ZH.ui.skip,
    body: `<div class="wide doc">\n${body}\n</div>`,
    footer: `<p>${esc(ZH.disclaimer.paras[0] ?? "")}</p><p><a href="/">首頁</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="${REPO}">GitHub</a></p>`,
  });
}

function paramTable(rows: ParamRow[]): string {
  if (rows.length === 0) return "<p>這個工具沒有參數。</p>";
  const body = rows
    .map((r) => `<tr><td><code>${esc(r.name)}</code></td><td><code>${esc(r.type)}</code></td><td>${r.required ? "必填" : "選填"}</td><td>${esc(r.description)}</td></tr>`)
    .join("\n");
  return `<div class="tbl"><table>
<thead><tr><th scope="col">參數</th><th scope="col">型別</th><th scope="col">必填</th><th scope="col">說明</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
}

export const TOOLS_HTML: string = docShell(
  "/tools",
  "MCP 工具參考｜台灣碳排係數 MCP",
  `${SITE_NAME} 的 ${TOOLS.length} 個 MCP 工具：名稱、用途與每個參數的型別與說明。`,
  `<h1>MCP 工具參考</h1>
<p>端點 <code>${MCP_ENDPOINT}</code>（Streamable HTTP，不需認證）。下列 ${TOOLS.length} 個工具全部唯讀，由伺服器實際註冊的定義產生。</p>
${copyable(ZH_LABELS, MCP_ENDPOINT)}
<ul>
${TOOLS.map((t) => `<li><a href="#${esc(t.name)}"><code>${esc(t.name)}</code></a>：${esc(t.summary.zh)}</li>`).join("\n")}
</ul>
${TOOLS.map(
  (t) => `<section id="${esc(t.name)}">
<h2><code>${esc(t.name)}</code></h2>
<p><strong>${esc(t.title)}</strong></p>
<p>${esc(t.description)}</p>
${paramTable(TOOL_PARAMS.get(t.name) ?? [])}
</section>`,
).join("\n")}`,
);

interface Route {
  method: "GET" | "POST";
  path: string;
  summary: string;
  params: string;
}

const ROUTES: Route[] = [
  { method: "GET", path: "/api/v1/sources", summary: "列出官方資料來源與狀態。", params: "無" },
  {
    method: "GET",
    path: "/api/v1/factors",
    summary: "搜尋排放係數。",
    params: "查詢參數：query、category、factor_type、year、unit、limit、offset",
  },
  { method: "GET", path: "/api/v1/factors/:id", summary: "取得單一係數的完整資訊。", params: "選填查詢參數 ?version= 指定版本" },
  { method: "GET", path: "/api/v1/factors/:id/versions", summary: "列出係數的歷史版本，新的在前。", params: "無" },
  {
    method: "GET",
    path: "/api/v1/electricity",
    summary: "查詢指定年度的電力排碳係數。",
    params: "查詢參數：year（必填）、usage_type（選填：industry_inventory、residential_tariff、utility_average）",
  },
  {
    method: "POST",
    path: "/api/v1/calculate",
    summary: "計算單一活動的排放量。",
    params: "JSON：factor_id、quantity、quantity_unit、year（選填）、optional_context（選填）、factor_version（選填）",
  },
  {
    method: "POST",
    path: "/api/v1/calculate/batch",
    summary: "批次計算多筆活動。",
    params: `JSON：{ "items": [...] }，每筆同 /api/v1/calculate，最多 ${MAX_BATCH} 筆`,
  },
  { method: "GET", path: "/api/v1/match", summary: "把活動或會計科目的描述對到候選係數，附單位相容性與適用條件，供確認後再計算。", params: "description（必填）、unit、year、limit" },
  {
    method: "POST",
    path: "/api/v1/inventory",
    summary: "計算多筆活動並依範疇一、二、三彙整成清冊，附各範疇小計與範疇一加二合計。",
    params: `JSON：{ "inventory_year"?: 2025, "items": [...] }，每筆同 /api/v1/calculate，另可帶 label 與 scope（1、2、3），最多 ${MAX_BATCH} 筆`,
  },
  { method: "GET", path: "/api/v1/status", summary: "各來源的同步狀態。", params: "無" },
  { method: "GET", path: "/health", summary: "服務健康檢查。", params: "無" },
];

const CALC_EXAMPLE_REQ = `{"factor_id":"tw-electricity-2025-industry-inventory","quantity":12000,"quantity_unit":"kWh","year":2025}`;
const CALC_CURL = `curl -X POST ${SITE_ORIGIN}/api/v1/calculate \\\n  -H "content-type: application/json" \\\n  -d '${CALC_EXAMPLE_REQ}'`;
const CALC_RESPONSE = json({
  ok: true,
  factor: { id: "tw-electricity-2025-industry-inventory", value: "0.466", reference_year: 2025 },
  emissions_kg: "5592",
  emissions_t: "5.592",
});
const ERROR_SHAPE = `{ "ok": false, "error": { "code": "...", "message": "...", "details": { } } }`;
export const API_DOCS_HTML: string = docShell(
  "/api/docs",
  "REST API 文件｜台灣碳排係數 MCP",
  `${SITE_NAME} 的唯讀 REST API：路由、參數、錯誤格式與計算範例。`,
  `<h1>REST API 文件</h1>
<p>基底網址 <code>${SITE_ORIGIN}</code>。唯讀、不需認證、有流量限制，JSON 請求內容上限 64 KB。REST API 與 MCP 工具共用同一套查詢與計算邏輯。</p>
<div class="tbl"><table>
<thead><tr><th scope="col">方法</th><th scope="col">路徑</th><th scope="col">說明</th><th scope="col">參數</th></tr></thead>
<tbody>
${ROUTES.map((r) => `<tr><td><span class="method">${r.method}</span></td><td><code>${esc(r.path)}</code></td><td>${esc(r.summary)}</td><td>${esc(r.params)}</td></tr>`).join("\n")}
</tbody>
</table></div>
<section id="errors">
<h2>錯誤格式</h2>
<p>失敗時回傳：</p>
${copyable(ZH_LABELS, ERROR_SHAPE)}
<p><code>code</code> 是機器可讀的錯誤代碼，<code>message</code> 是說明，<code>details</code> 視情況附上。查不到係數、單位不相容、年度不符或缺少必要資料時，都會回傳明確錯誤，不會猜測。</p>
</section>
<section id="example">
<h2>計算範例</h2>
<p>2025 年產業盤查使用的電力排碳係數，辦公室用電 12,000 度：</p>
${copyable(ZH_LABELS, CALC_CURL)}
<p>回應（節錄）：</p>
${copyable(ZH_LABELS, CALC_RESPONSE)}
<p>12,000 度 × 0.466 公斤CO2e/度 = 5592 公斤CO2e。完整回應另有公式、係數版本、來源網址與使用限制。</p>
</section>
<section id="notes">
<h2>注意事項</h2>
<ul>
<li>係數 ID 請從 <code>/api/v1/factors</code> 或 <code>/api/v1/electricity</code> 的結果取得，不要自行猜測。</li>
<li>指定 <code>year</code> 時，必須與係數的適用年度相符，不會自動以其他年度代替。</li>
<li>燃料燃燒係數需要在 <code>optional_context.lower_heating_value</code> 提供低位熱值。</li>
<li>結果僅供參考，不是認證、第三方查證或法令遵循的依據。</li>
</ul>
</section>`,
);

const toolLines = (): string =>
  TOOLS.map((t) => `- ${t.name}: ${t.summary.en} / ${t.summary.zh}`).join("\n");

const sourceLines = (): string =>
  SOURCES.map((s) => {
    const st = s.status === "active" ? "imported / 已匯入" : "synced by API, live status at /api/v1/status / 透過 API 同步，即時狀態見 /api/v1/status";
    return `- ${s.organization} ${s.dataset_name} (${st}): ${s.official_url}`;
  }).join("\n");

const LIMITS = `- Coverage today: electricity (2005-2025), tap water, and fuel combustion (Ministry of Environment announcement of 5 Feb 2024, kg/TJ). Product carbon footprint factors (CFP_P_02) are synced by API; they are life-cycle footprints, not organisational inventory factors, and per-item ones are lookup-only.
- Fuel calculations need a user-supplied lower heating value; there is no official per-litre factor and the service never assumes one.
- For 2025 there are three electricity values (0.466 industry inventory, 0.471 non-commercial lighting and flat-rate lighting customers, 0.467 public utility average, kgCO2e/kWh).
- Taiwan Water Corporation values are CO2 and Taipei Water Department values are CO2e; they must not be added.
- If a factor is not found, the service says so. It never fabricates or substitutes another year.
- Results are for reference only: not a certified GHG inventory, third-party verification or legal-compliance guarantee.
- 目前涵蓋：電力（2005-2025）、自來水、燃料燃燒（環境部 113 年 2 月 5 日公告，kg/TJ）。產品碳足跡係數（CFP_P_02）透過 API 同步；它是產品生命週期碳足跡，不是組織盤查係數，以件數計的僅供查詢。
- 燃料計算需要使用者提供低位熱值；官方沒有每公升係數，服務不會自行假設。
- 查不到就明說查不到，不編造數字，也不以其他年度代替。結果僅供參考，不是認證、第三方查證或法令遵循的依據。`;

const INSTALL_TXT = `- Claude (web/desktop): Settings > Connectors > Add custom connector, URL ${MCP_ENDPOINT}
- Claude Code: ${CLAUDE_CODE_CMD}
- Cursor (.cursor/mcp.json): ${JSON.stringify({ mcpServers: { carbon: { url: MCP_ENDPOINT } } })}
- Codex CLI (~/.codex/config.toml): [mcp_servers.carbon] url = "${MCP_ENDPOINT}"
- VS Code (.vscode/mcp.json): ${JSON.stringify({ servers: { carbon: { type: "http", url: MCP_ENDPOINT } } })}
- Gemini CLI: ${CLIENT_SNIPPETS.gemini[0]}
- ChatGPT: custom connectors with developer mode, same URL, no authentication; availability depends on plan and changes over time.
- Any other client: Streamable HTTP, URL ${MCP_ENDPOINT}. Client menus and plan availability change and are not guaranteed.`;

const PROMPTS_TXT = EN.prompts.map((p) => `- ${p}`).join("\n") + "\n" + ZH.prompts.map((p) => `- ${p}`).join("\n");
export const LLMS_TXT = `# ${SITE_NAME} (Unofficial) / 台灣碳排係數與碳排計算 MCP（非官方）

> ${EN.description}
> ${ZH.description}
>
> Unofficial: provided by taux.io; not affiliated with or endorsed by any government agency. Results are for reference only.
> 非官方服務：由 taux.io 提供，與任何政府機關無隸屬關係。結果僅供參考。

## Connection / 連線方式

- Endpoint: ${MCP_ENDPOINT}
- Transport: Streamable HTTP (remote MCP). Authentication: none. Cost: free, read-only, no sign-up.
- 傳輸：Streamable HTTP（遠端 MCP）；認證：不需要；費用：免費、唯讀、免註冊。

## Tools / 工具

${toolLines()}

Full parameters: ${SITE_ORIGIN}/tools

## Official sources / 官方資料來源

${sourceLines()}

Licence: ${LICENSE_URL}. ${ATTRIBUTION}

## Typical questions / 常見問法

${PROMPTS_TXT}

## Data limits / 資料限制

${LIMITS}

## Install / 安裝

${INSTALL_TXT}

## 日本語

${JA.description}
${JA.subtitle}

## Pages / 延伸資料

- Homepage (繁體中文): ${SITE_ORIGIN}/
- Homepage (English): ${SITE_ORIGIN}/en
- Homepage (日本語): ${SITE_ORIGIN}/ja
- MCP tool reference: ${SITE_ORIGIN}/tools
- REST API docs: ${SITE_ORIGIN}/api/docs
- Full text for LLMs: ${SITE_ORIGIN}/llms-full.txt
- Source code: ${REPO}
`;

function methodologyText(): string {
  const m = methodology();
  const topics = METHODOLOGY_TOPICS.map((k) => {
    const t = m.topics[k as keyof typeof m.topics] as { title: string; body: readonly string[] } | undefined;
    return t ? `### ${t.title}\n\n${t.body.map((b) => `- ${b}`).join("\n")}` : "";
  }).filter(Boolean);
  return `${topics.join("\n\n")}\n\nOfficial references / 官方依據:\n${m.official_references.map((r) => `- ${r.title}: ${r.url}`).join("\n")}`;
}

function toolFullText(): string {
  return TOOLS.map((t) => {
    const rows = TOOL_PARAMS.get(t.name) ?? [];
    const params = rows.length
      ? rows.map((r) => `- ${r.name} (${r.type}, ${r.required ? "required" : "optional"}): ${r.description}`).join("\n")
      : "- (no parameters)";
    return `### ${t.name}\n\n${t.description}\n\nParameters:\n${params}`;
  }).join("\n\n");
}

function restText(): string {
  const routes = ROUTES.map((r) => `- ${r.method} ${r.path}: ${r.summary} Parameters: ${r.params}`).join("\n");
  return `${routes}

Read-only, no authentication, rate-limited; JSON request bodies are capped at 64 KB.
Errors: ${ERROR_SHAPE}

Worked example:
POST ${SITE_ORIGIN}/api/v1/calculate
${CALC_EXAMPLE_REQ}
-> 12,000 kWh x 0.466 kgCO2e/kWh, "emissions_kg": "5592"`;
}

export const LLMS_FULL_TXT = `${LLMS_TXT}
---

# Full reference / 完整說明

## Tool descriptions and parameters

${toolFullText()}

## REST API

${restText()}

## Methodology and data limits / 計算方法與資料限制

${methodologyText()}

### Data limits

${LIMITS}

## Source notes / 來源備註

${SOURCES.map((s) => `- ${s.organization} ${s.dataset_name}: ${s.notes ?? ""}`).join("\n")}
`;

export const ROBOTS_TXT = `# 完整說明見 ${SITE_ORIGIN}/llms.txt

User-agent: *
Allow: /
Disallow: /mcp

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LOCALE_KEYS.map(
  (l) => `  <url>
    <loc>${SITE_ORIGIN}${LOCALES[l].path}</loc>
    <lastmod>${LASTMOD}</lastmod>
${LOCALE_KEYS.map((o) => `    <xhtml:link rel="alternate" hreflang="${LOCALES[o].hreflang}" href="${SITE_ORIGIN}${LOCALES[o].path}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/"/>
  </url>`,
).join("\n")}
  <url>
    <loc>${SITE_ORIGIN}/tools</loc>
    <lastmod>${LASTMOD}</lastmod>
  </url>
  <url>
    <loc>${SITE_ORIGIN}/api/docs</loc>
    <lastmod>${LASTMOD}</lastmod>
  </url>
</urlset>
`;

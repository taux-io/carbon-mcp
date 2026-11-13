# Taiwan Carbon Open Data（非官方）

台灣碳排係數與碳排計算 MCP。讓 Claude、ChatGPT、Cursor、Codex 等支援 MCP 的 AI 客戶端查詢台灣政府公開的碳排放係數，做可追溯、可重現的排放量計算。

> 讓 AI 查得到官方碳排係數、算得出排放量，也說得清楚資料來源與計算依據。

這是 taux.io 的**非官方**公共資料服務，不是政府網站，與資料提供機關沒有隸屬關係。計算結果僅供參考，不構成碳盤查認證、第三方查證或法定合規保證。

**目前狀態：已部署在 `https://carbon.taux.io`。**

## 連線

端點：`https://carbon.taux.io/mcp`。Streamable HTTP，不需註冊、不需 API Key，唯讀。

```bash
claude mcp add --transport http carbon https://carbon.taux.io/mcp
```

其他客戶端的設定方式見首頁。

## 目前收錄的資料

| 類別 | 來源 | 範圍 |
|---|---|---|
| 電力排碳係數 | 經濟部能源署 | 2005–2025。2025 年有三個數值：產業盤查使用 0.466、表燈非營業與包燈用戶 0.471、公用售電業 0.467（公斤CO2e/度） |
| 自來水 | 台灣自來水公司 | 2007–2025（公斤 CO2／度） |
| 自來水 | 臺北自來水事業處 | 2018–2025（公斤 CO2e／度） |
| 燃料燃燒 | 環境部 113 年 2 月 5 日公告 | 固定燃燒 53 種、移動燃燒 5 筆，kg/TJ，分 CO2、CH4、N2O |
| 冷媒等逸散 | 環境部 113 年 2 月 5 日公告 | 含氟氣體的溫暖化潛勢 46 筆；年逸散率由使用者提供；混合冷媒由使用者提供成分比例 |
| 產品碳足跡 | 環境部 `CFP_P_02` | 透過 API 同步，需要 API 金鑰。實測 1,188 筆，其中 899 筆可計算、289 筆僅供查詢 |

來源、授權與每一項的限制見 [`docs/data-sources.md`](docs/data-sources.md)。

兩件容易誤會的事：

- **燃料沒有「每公升」的官方係數。** 環境部公告的是每兆焦耳的係數，計算時要自行提供低位熱值。服務不會假設熱值。
- **2025 年的電力係數有三個。** 組織盤查用 0.466。只給年度不給用途時，服務會三個都回，不會代為選擇。

## MCP 工具

`ping`、`list_data_sources`、`search_emission_factors`、`match_activity`、`get_emission_factor`、`get_electricity_factor`、`calculate_emissions`、`calculate_batch`、`build_inventory`、`compare_emissions`、`list_factor_versions`、`check_factor_updates`、`get_methodology`。

定義在 [`src/tools.ts`](src/tools.ts)；參數說明在 `/tools`。

要把多筆活動整理成盤查清冊的樣子，用 `build_inventory`（REST：`POST /api/v1/inventory`）。它依範疇一、二、三分類，給各範疇小計、範疇一依氣體分列，以及範疇一加二的合計。會誤導的數字不給：混用 CO2 與 CO2e、有項目算不出來、或範疇三含產品碳足跡時，對應的小計或合計會附原因扣住。範疇分類是依係數類型的預設，可逐筆用 `scope` 覆寫。它只涵蓋你提供的活動，不是完整的盤查。

使用者的說法不是官方係數名稱時（「10 月電費」「塑膠原料採購」），用 `match_activity`：它回傳候選係數、單位是否相容、適用條件與待確認事項，不會代為選定。ERP 串接時可用它把會計科目對到係數，由人確認後把 `factor_id` 存起來重複使用。

## REST API

與 MCP 共用同一套查詢與計算邏輯（`src/service.ts`）。全部唯讀。

```
GET  /api/v1/sources
GET  /api/v1/factors?query=&category=&factor_type=&year=&unit=&limit=&offset=
GET  /api/v1/factors/:id            （可加 ?version=）
GET  /api/v1/factors/:id/versions
GET  /api/v1/electricity?year=&usage_type=
GET  /api/v1/match?description=&unit=&year=&limit=
POST /api/v1/calculate
POST /api/v1/calculate/batch
POST /api/v1/inventory
GET  /api/v1/status
GET  /health
```

```bash
curl -s http://127.0.0.1:8787/api/v1/calculate \
  -H 'content-type: application/json' \
  -d '{"factor_id":"tw-electricity-2025-industry-inventory","quantity":12000,"quantity_unit":"kWh","year":2025}'
# → "emissions_kg":"5592"，附係數版本、來源網址與限制說明
```

失敗的形狀是 `{ "ok": false, "error": { "code", "message", "details" } }`。文件在 `/api/docs`。

## 本機開發

需要 Node 24 以上。

```bash
npm install
npm run db:local      # 套用 migrations 到本機 D1
npm run dev           # http://127.0.0.1:8787
npm run seed:local    # 另開終端機：觸發一次排程，把已審核的官方資料寫進本機 D1
npm run smoke         # 端到端檢查
```

資料庫只由排程寫入。`seed:local` 觸發的排程會匯入已審核資料、向能源署的開放資料 CSV 做一次交叉檢查，並同步 `CFP_P_02`（沒有金鑰就略過）。要同步 `CFP_P_02`，把 `.dev.vars.example` 複製成 `.dev.vars` 並填入環境部 API 金鑰。

```bash
npm test                              # 全部測試，離線
npx vitest run test/engine.test.ts    # 單一檔案
npm run typecheck
npm run dry-run                       # 確認 Worker 能 bundle
```

## 測試結果

2026-11-13 在開發機上的結果：

- `npm test`：8 個檔案、238 項測試全部通過。
- `npm run typecheck`、`npm run dry-run`：通過。
- `npm run smoke`（本機 `wrangler dev` 與本機 D1）：24 項檢查全部通過，包含兩個 MCP 協定版本的 `initialize`、`tools/list`、`tools/call`，以及 REST 計算。12,000 kWh 的 2025 年產業用電算出 5,592 kgCO2e，係數 0.466 讀自資料庫。
- 同一次排程向能源署開放資料 CSV 做了真實的交叉檢查：CSV 的 21 個年度與已審核資料一致。
- 引擎重現了環境部《溫室氣體排放量盤查作業指引 113 年版》的柴油與天然氣算例，各氣體到小數第四位相符。
- 以環境部會員金鑰在本機做了真實的 `CFP_P_02` 同步：1,188 筆全部匯入，金鑰沒有出現在狀態端點或日誌。
- 正式環境：`npm run smoke -- https://carbon.taux.io` 目前 25 項（2026-11-13）檢查全部通過。第一次排程從 Cloudflare 連上了能源署與環境部，交叉檢查一致，`CFP_P_02` 同步 1,188 筆。
- 透過 claude.ai 的 MCP 連接器對正式環境實際呼叫工具：三個示範問句共六次呼叫，結果與預期一致，包含冷媒缺少計算依據時回 `missing_refrigerant_basis`。紀錄在 [`docs/claude-directory-submission.md`](docs/claude-directory-submission.md) 的「連接器實測紀錄」。
- 限流有兩層，都實測過：zone 的 WAF 規則擋平行洪水（平行 300 次中 193 次得到 429），Worker 內的限流擋單一連線的失控迴圈。WAF 規則與 `twse-mcp` 共用計數。見 [`docs/deployment.md`](docs/deployment.md) 的「限流」。
- 網站已用無頭 Chrome 檢查三個語系、手機與桌面寬度、深淺色共 12 種組合（無水平捲動、對比足夠），並目視看過截圖。

正式環境另有每日自動檢查（對照表、冒煙測試、MCP Registry 條目），失敗時會開 issue，見 [`docs/deployment.md`](docs/deployment.md)。

沒有驗證的事：

- AI 用戶端在對話中的行為。連接器實測是直接呼叫工具，而且執行測試的 AI 事先知道流程。全新的對話收到自然語言的問句時會不會自己選對工具、會不會先問缺少的資料，沒有驗證過。
- Claude 以外的用戶端（ChatGPT、Cursor、Codex）沒有連線測試過。
- 網站沒有在實體手機上看過。

## 已完成與未完成

已完成：

- Worker、MCP Server（13 個工具，無狀態，兩個協定版本）、REST API、D1 schema 與 migration。
- 精確十進位計算引擎：單位檢查、年度規則、燃料熱值路徑、批次合計條件、比較拆解。
- 係數版本管理：內容改變時保留舊版本，可用 `factor_id` 加 `factor_version` 重現過去的計算。
- 資料同步：已審核資料匯入、能源署 CSV 交叉檢查、`CFP_P_02` 同步程式與異常防護。
- 三語首頁、工具說明、API 文件、`llms.txt`、`llms-full.txt`、sitemap、robots、JSON-LD。
- 限流、body 上限、CORS 白名單、拒絕 JSON-RPC 批次。

未完成或待驗證：

- **用詞對照只涵蓋常見品項。** `match_activity` 靠 `src/concepts.ts` 的對照表把「塑膠原料」「電費」「公務車加油」對到候選係數；表裡沒有的說法（例如差旅、住宿）對不到。比對的是名稱裡的字，所以「聚丙烯」也會帶出「聚丙烯腈棉」，要由使用者確認。以包、瓶、片等件數計的係數只能查、不能算。
- 用水以外的擴充來源（運輸、廢棄物）：沒有找到邊界明確的官方結構化係數，未收錄。
- 環境部公告的附表二製程與附表三的廢水、廢棄物：它們是公式與參數，不是可直接計算的係數。R-22 與碳氫冷媒不在官方表內，無法計算。
- 政府檔案（能源署 PDF、環境部公告）的重製授權未能在官方頁面確認。

## 隱私

不需帳號、不設 Cookie、不記錄你問的內容與工具參數。Cloudflare 保存連線中繼資料最長 7 天。完整內容見 <https://carbon.taux.io/privacy> 與 [`PRIVACY.md`](PRIVACY.md)。

## 授權

程式碼以 MIT 授權。資料屬各提供機關，標示政府資料開放授權條款－第1版者依該條款利用（<https://data.gov.tw/license>）。

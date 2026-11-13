# Taiwan Carbon Open Data（非官方）

台灣碳排係數與碳排計算 MCP。讓 Claude、ChatGPT、Cursor、Codex 等支援 MCP 的 AI 客戶端查詢台灣政府公開的碳排放係數，做可追溯、可重現的排放量計算。

> 讓 AI 查得到官方碳排係數、算得出排放量，也說得清楚資料來源與計算依據。

這是 taux.io 的**非官方**公共資料服務，不是政府網站，與資料提供機關沒有隸屬關係。計算結果僅供參考，不構成碳盤查認證、第三方查證或法定合規保證。

**目前狀態：可在本機完整執行，尚未部署。** `https://carbon.taux.io` 還沒有上線。

## 連線

端點（部署後）：`https://carbon.taux.io/mcp`。Streamable HTTP，不需註冊、不需 API Key，唯讀。

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
| 燃料燃燒 | 環境部 113 年 2 月 5 日公告 | 固定燃燒 5 種、移動燃燒 5 筆，kg/TJ，分 CO2、CH4、N2O |
| 產品碳足跡 | 環境部 `CFP_P_02` | **尚未匯入**（需要 API 金鑰） |

來源、授權與每一項的限制見 [`docs/data-sources.md`](docs/data-sources.md)。

兩件容易誤會的事：

- **燃料沒有「每公升」的官方係數。** 環境部公告的是每兆焦耳的係數，計算時要自行提供低位熱值。服務不會假設熱值。
- **2025 年的電力係數有三個。** 組織盤查用 0.466。只給年度不給用途時，服務會三個都回，不會代為選擇。

## MCP 工具

`ping`、`list_data_sources`、`search_emission_factors`、`get_emission_factor`、`get_electricity_factor`、`calculate_emissions`、`calculate_batch`、`compare_emissions`、`list_factor_versions`、`check_factor_updates`、`get_methodology`。

定義在 [`src/tools.ts`](src/tools.ts)；參數說明在 `/tools`。

## REST API

與 MCP 共用同一套查詢與計算邏輯（`src/service.ts`）。全部唯讀。

```
GET  /api/v1/sources
GET  /api/v1/factors?query=&category=&factor_type=&year=&unit=&limit=&offset=
GET  /api/v1/factors/:id            （可加 ?version=）
GET  /api/v1/factors/:id/versions
GET  /api/v1/electricity?year=&usage_type=
POST /api/v1/calculate
POST /api/v1/calculate/batch
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

- `npm test`：5 個檔案、127 項測試全部通過。
- `npm run typecheck`、`npm run dry-run`：通過。
- `npm run smoke`（本機 `wrangler dev` 與本機 D1）：19 項檢查全部通過，包含兩個 MCP 協定版本的 `initialize`、`tools/list`、`tools/call`，以及 REST 計算。12,000 kWh 的 2025 年產業用電算出 5,592 kgCO2e，係數 0.466 讀自資料庫。
- 同一次排程向能源署開放資料 CSV 做了真實的交叉檢查：CSV 的 21 個年度與已審核資料一致。
- 引擎重現了環境部《溫室氣體排放量盤查作業指引 113 年版》的柴油與天然氣算例，各氣體到小數第四位相符。

沒有驗證的事：

- 沒有部署，所以正式網域、Custom Domain、Cron、限流綁定、以及從 Cloudflare 連政府網站是否會被擋，都沒有驗證。
- `CFP_P_02` 沒有以真實金鑰呼叫過。
- 網站沒有在瀏覽器中目視檢查（手機版、深色模式、無障礙），只有自動化測試檢查結構。
- 沒有用實際的 MCP 客戶端（Claude、Cursor 等）連線測試。

## 已完成與未完成

已完成：

- Worker、MCP Server（11 個工具，無狀態，兩個協定版本）、REST API、D1 schema 與 migration。
- 精確十進位計算引擎：單位檢查、年度規則、燃料熱值路徑、批次合計條件、比較拆解。
- 係數版本管理：內容改變時保留舊版本，可用 `factor_id` 加 `factor_version` 重現過去的計算。
- 資料同步：已審核資料匯入、能源署 CSV 交叉檢查、`CFP_P_02` 同步程式與異常防護。
- 三語首頁、工具說明、API 文件、`llms.txt`、`llms-full.txt`、sitemap、robots、JSON-LD。
- 限流、body 上限、CORS 白名單、拒絕 JSON-RPC 批次。

未完成或待驗證：

- **部署。** 資源清單與步驟在 [`docs/deployment.md`](docs/deployment.md)，需確認後執行。
- **`CFP_P_02` 產品碳足跡係數。** 待取得環境部 API 金鑰後實測並確認紀錄的唯一性。在那之前，查「塑膠原料」「衛生紙」這類係數會得到「查不到」。
- 用水以外的擴充來源（運輸、廢棄物）：沒有找到邊界明確的官方結構化係數，未收錄。
- 環境部公告中的其餘燃料、製程與逸散係數。
- 網站的社群分享圖（og:image）與 favicon。
- 政府檔案（能源署 PDF、環境部公告）的重製授權未能在官方頁面確認。

## 授權

程式碼以 MIT 授權。資料屬各提供機關，標示政府資料開放授權條款－第1版者依該條款利用（<https://data.gov.tw/license>）。

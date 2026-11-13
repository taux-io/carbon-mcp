# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 這是什麼

Taiwan Carbon Open Data：taux.io 的非官方 MCP 服務（`https://carbon.taux.io/mcp`），讓 AI 查台灣政府公開的碳排係數並做可追溯的計算。Cloudflare Workers + D1，無狀態 Streamable HTTP，不用 Durable Objects。同系列的參考專案在 `../twse-mcp`（主要範本）與 `../roadsafety.tw`。

## 指令

```bash
npm test                                   # 全部測試（離線，出站 fetch 都是替身）
npx vitest run test/engine.test.ts         # 單一檔案
npx vitest run -t "12,000 kWh"             # 依名稱跑單一測試
npm run typecheck
npm run dry-run                            # 確認 Worker 能 bundle

npm run db:local                           # 套用 migrations 到本機 D1
npm run dev                                # wrangler dev --test-scheduled
npm run seed:local                         # 觸發一次排程，把已審核資料寫進本機 D1（dev 要先跑著）
npm run smoke                              # 對跑著的服務做端到端檢查（可帶 base URL）
npm run check-concepts                     # 檢查用詞對照表的每個字在跑著的服務上都找得到係數
```

需要 Node 24 以上：測試用內建的 `node:sqlite` 當 D1 的替身（`test/d1.ts`），直接套用 `migrations/` 的 SQL。它是替身不是 D1，動到 SQL 的修改還要用 `npm run dev` + `npm run smoke` 在本機 D1 上跑一次。

## 架構

請求有四條路，全在 `src/server.ts`：靜態頁面（路由表白名單，不是 catch-all）、`/health` 與 `/api/v1/*`（REST）、`/mcp`、以及排程 `scheduled`。

分層由外到內：

- `src/server.ts`、`src/api.ts`：傳輸層。MCP 註冊、REST 路由、body 上限、批次拒絕、限流、CORS。不放商業邏輯。
- `src/tools.ts`：11 個 MCP 工具的定義表（名稱、說明、zod 參數）。MCP 註冊、REST 的參數驗證、網站的工具說明與 `llms.txt` 都從這一份產生。
- `src/service.ts`：MCP 與 REST 共用的唯一一套查詢與計算流程。新功能加在這裡，再由 `tools.ts` 與 `api.ts` 各接一個薄殼。
- `src/match.ts`、`src/concepts.ts`：科目對照。`concepts.ts` 是本服務整理的用詞對照表（「塑膠原料」→ 名稱含「聚丙烯」…的係數），`match.ts` 用它找候選、檢查單位、列出待確認事項。它只找候選，不選定係數。改對照表後用 `npm run check-concepts -- <baseUrl>` 確認每個字在真實資料裡都找得到係數。
- `src/engine.ts`、`src/units.ts`：純函式的計算引擎與單位換算，不碰資料庫與網路。
- `src/store.ts`：D1 存取。上半部是寫入（只有排程會呼叫），下半部是查詢。
- `src/sync.ts`：排程工作。
- `src/data/reviewed.ts`：人工審核後匯入的官方數值。
- `src/site.ts`：首頁（繁中、英、日）、工具說明、API 文件、`llms.txt`、SEO。模組載入時算一次的字串模板。

## 不可違反的規則

這些是產品的核心承諾，改動前先讀 `src/engine.ts` 開頭與對應的測試。

- **係數只來自資料庫。** 引擎與服務層不可寫死任何係數。測試案例 12,000 kWh × 0.466 = 5,592 也是從資料庫讀係數。
- **查不到就說查不到。** 不估算、不補齊、不拿相近的東西代替。`search_emission_factors` 只做字面比對；用詞對照得到的結果只出現在 `match_activity`，而且一律標示為需確認的候選。
- **年度不自動替代。** 使用者指定年度而係數不符時回錯誤並列出可用年度。`reference_year` 是適用年度，不是公告年份；`announcement_date` 只存官方頁面上觀察到的日期，推論的一律 `null`。
- **單位只在同量綱內換算。** 沒有密度不把公升換成公斤。「度」在電是 kWh、在水是 m³，由係數的分母決定。
- **數值是十進位字串。** 用 `big.js` 做精確乘法，照官方寫法儲存（`"0.530"`、`"0.17"`），不四捨五入。
- **CO2 與 CO2e 不相加**（台灣自來水公司公布的是 CO2）。產品碳足跡係數與組織盤查係數不相加。批次合計只在條件相容時提供。
- **燃料燃燒的低位熱值必須由使用者提供。** 官方只公布 kg/TJ，沒有預設熱值，也沒有每公升係數。
- **公開端唯讀。** 沒有任何 HTTP 或 MCP 的寫入路徑。資料庫只由 `scheduled` 寫入。
- **歷史版本不覆蓋。** 係數內容改變時 `upsertFactors` 會加一個版本，舊版留在 `factor_versions`。

## 資料怎麼進資料庫

兩條路，都只由排程觸發：

1. **審核後匯入**（電力、自來水、燃料公告）：這些來源沒有可靠的結構化 API。數值寫在 `src/data/reviewed.ts`，經 git 審查進版，排程的 `importReviewed` 寫入 D1。內容沒變就不動，所以可以重跑。新增或更正數值就是改這個檔案，並附上官方文件的網址。
2. **API 同步**（環境部 `CFP_P_02`）：需要 `MOENV_API_KEY`。資料有任何異常（非 JSON、空白、筆數驟降、欄位缺漏、無法區分的重複紀錄）就整批不寫，保留上次成功的資料並把來源標為 `stale`。

能源署的開放資料 CSV 只用來交叉檢查（`crossCheckElectricity`）：與已審核數值不一致時標記 `review_needed`，不寫係數。原因是 CSV 只有公用售電業的數值，114 年度起盤查要用的 0.466 只在 PDF 裡。

`CFP_P_02` 沒有紀錄 ID，而且有少數紀錄的名稱、單位、發布單位、公告年份相同而數值不同（2026-11-13 實測：1,188 筆中 13 組）。所以 `cfpToFactor` 的 ID 是這四個欄位加上數值的雜湊；官方更正數值時會表現為舊係數撤回（`status = withdrawn`，不刪除）、新係數出現。無法區分的紀錄與以件數計的單位（包、瓶、片）標為 `lookup_only`。

## 慣例

- 沿用 `twse-mcp` 的做法：不用 Hono，手寫路由；MCP handler 與 server **每個請求建一次**，不要提到模組層級。
- 工具說明英文在前、繁體中文在後，寫在同一個字串。
- 工具失敗回 `isError: true` 加 `{ ok: false, error: { code, message, details } }`；REST 用同一個形狀配 HTTP 狀態碼。
- 註解與文件用繁體中文（台灣用語），只寫程式碼看不出來的「為什麼」。
- 上游可能回 2xx 的錯誤頁（環境部缺金鑰時回 200 加純文字），一律先讀文字再自己判斷。
- 會影響 Cloudflare 資源、DNS 或正式環境的操作（`wrangler deploy`、`d1 create`、`--remote`、設定 secret）先列出變更並取得確認。

## 正式環境的每日檢查

`.github/workflows/production-check.yml` 每天對正式環境跑 `check-concepts` 與 `smoke`，失敗時開標籤為 `production-check` 的 issue，恢復後自動關閉。改 `src/concepts.ts` 或 `scripts/smoke.mjs`（例如工具數量改變）後，部署完用 `gh workflow run production-check.yml` 跑一次確認。細節見 `docs/deployment.md`。

## 尚未完成

見 `README.md` 的「已完成與未完成」。

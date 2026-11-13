# 部署

已於 2026-11-13 部署到 `https://carbon.taux.io`（帳號：拓思科技股份有限公司）。這份文件列出部署用到的 Cloudflare 資源，以及重新建置時的步驟。

## 會新增或修改的 Cloudflare 資源

| 資源 | 動作 | 說明 |
|---|---|---|
| Worker `carbon-mcp` | 新增 | `wrangler deploy` 建立。`workers_dev: false`，不會有 workers.dev 網址。 |
| D1 資料庫 `carbon-mcp` | 新增 | `wrangler d1 create carbon-mcp`，把回傳的 ID 填進 `wrangler.jsonc`。 |
| Custom Domain `carbon.taux.io` | 新增 | `wrangler.jsonc` 的 `routes` 以 `custom_domain: true` 宣告；部署時會在 `taux.io` zone 建立對應的 DNS 紀錄與憑證。**這會修改 taux.io 的 DNS。** |
| Cron Trigger `30 19 * * *` | 新增 | 每天 03:30（台灣時間）跑同步。 |
| Rate Limiting 綁定 `RATE_LIMITER` | 新增 | Workers 的限流綁定，每個來源 IP 每 60 秒 120 次。不占用 zone 的 WAF 限流規則。 |
| Secret `MOENV_API_KEY` | 新增（選用） | 環境部 API 金鑰。沒有設定時只是略過 `CFP_P_02` 的同步。 |
| Workers Logs | 啟用 | `observability` 已在設定檔開啟。 |

不會動到既有的 `twse-mcp`、`roadsafety-mcp` 或 `taux.io` 的 Worker 與資料庫。

費用：請求量在 Workers 與 D1 的免費額度內即可運作。資料庫只有幾百列（加上 `CFP_P_02` 後預期是數千列），每天一次排程。可能超出免費額度的情況是公開端點遭到大量請求；限流綁定與 body 上限是為此設的。

## 步驟

每一步都會改動 Cloudflare 上的資源，執行前先確認。

```bash
# 1. 建立 D1，把輸出的 database_id 填進 wrangler.jsonc
npx wrangler d1 create carbon-mcp

# 2. 套用 schema
npm run db:remote

# 3.（選用）設定環境部 API 金鑰
npx wrangler secret put MOENV_API_KEY

# 4. 部署 Worker、Custom Domain 與 Cron
npm run deploy

# 5. 資料庫一開始是空的，資料只由排程寫入。儀表板沒有手動觸發已部署 Worker 的 Cron 的功能。
#    等下一次排程，或暫時在 wrangler.jsonc 的 crons 加上 "* * * * *" 部署，
#    待 /health 顯示 "database": "ok" 後移除並重新部署。
#    資料寫入前 /health 回 503 與 "database": "empty"，查詢與計算回 data_not_loaded。

# 6. 驗證
npm run smoke -- https://carbon.taux.io
```

## 部署後要確認的事

這些在本機無法驗證：

- **政府網站是否擋 Cloudflare 的對外連線。** 查證是從開發機做的。`https://www.moeaea.gov.tw`（電力 CSV 交叉檢查）與 `https://data.moenv.gov.tw`（`CFP_P_02`）要從部署後的 Worker 實際連一次。被擋時交叉檢查會記為 `failed`、來源標為 `stale`，可在 `/api/v1/status` 看到；已匯入的係數不受影響。
- **`CFP_P_02` 第一次同步的結果。** 回應結構與紀錄唯一性尚未以金鑰實測。第一次同步後檢查 `/api/v1/status`：如果因為「無法區分的重複紀錄」而失敗，需要依實際資料調整 `src/sync.ts` 中 `cfpToFactor` 的 ID 規則。
- **限流是否生效。** 2026-11-13 實測，結論是「有效，但只是近似值」：
  - 用同一條連線連續送，約第 104 次開始得到 429，並帶 `Retry-After: 60`。`npm run check-rate-limit` 可重現。
  - 用 8 到 16 條平行連線，160 次（3 秒內）與 600 次（24 秒內）**全部通過，沒有一次 429**。
  - 原因是 Workers 的限流綁定在每台機器各自計數、背景同步，官方文件明說請求可以超過設定的上限。平行請求散到不同機器，每台的計數都到不了 120。本機的 `wrangler dev` 只有一個計數器，所以本機測試是剛好 120 次放行。
  - 意思是它擋得住單一客戶端的失控迴圈，擋不住刻意平行送的流量。要嚴格的上限有兩條路：在 taux.io zone 加 WAF 限流規則（在進 Worker 之前擋，但免費方案只有一條規則，目前用在 `twse-mcp`，要改規則的條件才能涵蓋本服務），或用 Durable Object 自己計數。兩者都還沒做。
- **MCP 客戶端連線。** 至少用 Claude 與一個只支援舊版協定的客戶端各連一次。

## 每日檢查

`.github/workflows/production-check.yml` 每天台灣時間 04:15（排在 03:30 的資料同步之後）跑三個檢查，前兩個對 `https://carbon.taux.io`：

- `npm run check-concepts`：用詞對照表（`src/concepts.ts`）的每個字在即時資料裡都還找得到係數。環境部改了係數名稱時，這裡會先發現。
- `npm run smoke`：網頁、MCP 兩個協定版本、REST 計算與同步狀態。
- `npm run check-registry`：官方 MCP Registry 上的條目，名稱與連線位址是否仍與 `server.json` 一致。不一致而又不是自己改的，視為條目被竄改。

任一項失敗就開一個標籤為 `production-check` 的 issue，附上輸出與執行紀錄的連結；已經有未關閉的 issue 時改為留言，不重複開。之後檢查恢復正常會自動關閉那個 issue。

也可以手動執行，並指定要檢查的網址：

```bash
gh workflow run production-check.yml
gh workflow run production-check.yml -f base_url=https://carbon.taux.io
```

這個 workflow 分成兩個 job：執行 repo 程式的 `check` 只有讀取權限；有寫 issue 權限的 `report` 不取出也不執行 repo 裡的程式。

## 發版與送件

### 發版

1. 更新 `package.json` 與 `server.json` 的版本（兩者必須相同，測試會檢查），在 `CHANGELOG.md` 加一節。
2. `npm test`、`npm run deploy`、`npm run smoke -- https://carbon.taux.io`。
3. commit 並 push。

### 發布到官方 MCP Registry

`.github/workflows/publish-mcp.yml` 在推送 `v*` tag 時把 `server.json` 發布到 registry。第一次發布是 2026-11-13 的 `v0.2.2`，條目名稱 `io.github.taux-io/carbon-mcp`。

```bash
git tag v0.2.2 origin/main && git push origin v0.2.2
```

- workflow 會停在 `mcp-registry` environment 等待核准。到 GitHub 的 Actions 頁面核准後才會發布。
- 這個 environment 只允許 `v*` tag，並要求指定的審核者核准。它擋的是「有人拿到寫入權限就能打 tag，把 registry 上的連線位址改掉」。
- 認證用 GitHub OIDC，不需要任何長期 secret。命名空間 `io.github.taux-io/*` 由 repo 所在的組織證明。
- 發布工具 `mcp-publisher` 固定版本並驗證檢查碼。升級時要同時改 workflow 裡的版本與 SHA256。
- registry 不允許重發同一個版本。要重發就升版。
- `npm run check-registry` 比對線上條目與 `server.json`。每日檢查也會跑它。

本機可先驗證：下載同版本的 `mcp-publisher`，在 repo 根目錄執行 `mcp-publisher validate`（2026-11-13 驗證通過）。

### 送件 Claude Directory

送件表單由維護者自己填。已準備好的項目：

- 隱私權政策：<https://carbon.taux.io/privacy>，內容依實際行為撰寫。改動日誌、分析、Cookie、出站連線或資料庫儲存的內容時，這一頁要跟著改；`test/registry.test.ts` 有兩項檢查會在相關程式改變時失敗。
- 端點：`https://carbon.taux.io/mcp`，Streamable HTTP，不需認證。
- 所有工具都標示為唯讀（`readOnlyHint`）。
- 網站圖示：`/favicon.svg`；分享圖：`/og.png`。
- 原始碼：<https://github.com/taux-io/carbon-mcp>（MIT）。

沒有準備、送件時可能被要求的項目：測試帳號（本服務不需要帳號）、示範影片、客服信箱（目前的聯絡管道是 GitHub issues）。

## 回復

`npx wrangler rollback` 回到上一個版本。D1 的 schema 變更不會跟著回復；係數資料可由排程從 `src/data/reviewed.ts` 重新匯入。

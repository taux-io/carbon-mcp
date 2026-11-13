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
- **限流是否生效。** 短時間內送超過 120 次請求應得到 429。
- **MCP 客戶端連線。** 至少用 Claude 與一個只支援舊版協定的客戶端各連一次。

## 每日檢查

`.github/workflows/production-check.yml` 每天台灣時間 04:15（排在 03:30 的資料同步之後）對 `https://carbon.taux.io` 跑兩個檢查：

- `npm run check-concepts`：用詞對照表（`src/concepts.ts`）的每個字在即時資料裡都還找得到係數。環境部改了係數名稱時，這裡會先發現。
- `npm run smoke`：網頁、MCP 兩個協定版本、REST 計算與同步狀態。

任一項失敗就開一個標籤為 `production-check` 的 issue，附上輸出與執行紀錄的連結；已經有未關閉的 issue 時改為留言，不重複開。之後檢查恢復正常會自動關閉那個 issue。

也可以手動執行，並指定要檢查的網址：

```bash
gh workflow run production-check.yml
gh workflow run production-check.yml -f base_url=https://carbon.taux.io
```

這個 workflow 分成兩個 job：執行 repo 程式的 `check` 只有讀取權限；有寫 issue 權限的 `report` 不取出也不執行 repo 裡的程式。

## 回復

`npx wrangler rollback` 回到上一個版本。D1 的 schema 變更不會跟著回復；係數資料可由排程從 `src/data/reviewed.ts` 重新匯入。

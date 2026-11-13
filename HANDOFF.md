# 交接紀錄

寫於 2026-11-13，0.2.3 發布之後；狀態表已更新到 0.2.4 部署之後。這份文件記錄這一輪做了什麼、目前的狀態、以及接下來可以做的事。專案的規則與架構在 `CLAUDE.md`，部署與發版流程在 `docs/deployment.md`，這裡不重複。

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 正式環境 | `https://carbon.taux.io`，`/health` 回報 0.2.4，資料庫正常 |
| 分支 | `main`，本機與 `origin/main` 相同。正式環境跑的是 `934133f`（0.2.4），之後的 commit 只改文件 |
| Tag | `v0.2.4` 已推送 |
| 官方 MCP Registry | `io.github.taux-io/carbon-mcp` 最新版本 0.2.4（2026-11-13 發布，狀態 active） |
| 排程 | `30 19 * * *`（台灣時間 03:30），只有這一條 |
| 測試 | 8 個檔案、238 項通過；`main` 的 CI 通過 |
| 每日檢查 | 0.2.4 部署後手動觸發一次，通過；沒有未關閉的 `production-check` issue |

## 這一輪做了什麼

依時間順序，每一項都已上線。

1. **示範問句的連接器實測**（`60d4f8e`）。透過 claude.ai 的連接器對正式環境跑了送件文件的三個示範問句，共六次工具呼叫，結果記在 `docs/claude-directory-submission.md` 第 6 節。示範三有兩種錯誤：完全沒說數量依據是 `missing_refrigerant_basis`，說了是填充量但沒給逸散率是 `invalid_leak_rate`。
2. **sitemap 在瀏覽器裡顯示成 XML 樹**（`17f1e5f`）。原本 Chrome 把它顯示成一行文字，因為裡面的 `<xhtml:link>` 屬於 XHTML 命名空間。已移除；語系宣告留在各頁的 `<head>`。
3. **兩處過時文字**（`423a27a`）。`search_emission_factors` 的說明補上冷媒與產品碳足跡。含氟氣體係數的使用限制改成說明混合冷媒可用 `refrigerant_blend` 計算。
4. **46 筆含氟氣體係數升到版本 2**。使用限制是係數內容的一部分，所以文字一改就多一個版本。GWP 數值沒變，指定 `factor_version: 1` 的計算仍可重現。為了不等到隔天，用暫時的每分鐘排程觸發了一次匯入，之後已改回。
5. **發布 0.2.3**（`d081d79`、tag `v0.2.3`）。
6. **文件更正**。`README.md` 的測試數（227 項）、smoke 檢查數（24 項）、工具數（13 個）與「沒有驗證的事」改成現況。這份交接紀錄也在同一個 commit 進版。

同一輪也動了姊妹專案 `../twse-mcp`：它的 sitemap 有同樣的問題，修正隨 PR #273 合併並已上線。那個 PR 的標題與說明只講健檢，sitemap 的說明補在留言裡：<https://github.com/taux-io/twse-mcp/pull/273#issuecomment-6852653761>。

## 這一輪學到的事

- **改 `src/data/reviewed.ts` 的任何欄位都會讓係數升版本**，包括說明文字。而且部署當下不會生效，要等排程跑過。要立刻生效可以用 `npx wrangler deploy --triggers "* * * * *"` 暫時改排程，等匯入完成後再 `npx wrangler deploy` 改回。這會動到正式環境，每次都要先取得確認。整個過程約 6 分鐘，不需要改 `wrangler.jsonc`。
- **部署要指定 Cloudflare 帳號。** wrangler 登入了三個帳號，`wrangler.jsonc` 沒有寫 `account_id`，非互動模式下 `wrangler deploy` 會失敗。`carbon-mcp` 在「拓思科技股份有限公司」帳號，指令前加 `CLOUDFLARE_ACCOUNT_ID=5164de0801b523f919f7a9eac9bbf9bf`。
- **MCP 用戶端會快取工具清單。** 部署新的工具說明之後，已連線的用戶端看到的還是舊說明。要確認伺服器實際回什麼，直接對 `/mcp` 送 `tools/list`。
- **不要把未 commit 的改動留在別的工作階段正在用的工作目錄。** `twse-mcp` 的 sitemap 修正就是這樣被另一個工作階段的 commit 帶走，沒有經過確認就合併上線。之後在共用的工作目錄做事，先開分支或用 worktree。
- **瀏覽器顯示問題可以用無頭 Chrome 重現。** 透過 CDP 檢查頁面有沒有 `webkit-xml-viewer-source-xml` 這個元素，就知道 Chrome 有沒有用 XML 樹狀檢視。

## 接下來可以做的事

依我判斷的價值排序。前兩項要由人來做。

1. **在 Claude 的對話介面親自問三個示範問句。** 連接器實測證明工具行為正確，但執行測試的 AI 事先知道流程。一個全新的對話會不會自己選對工具、會不會在示範三先問逸散率，還沒有人看過。建議加問一題「R-410A 混合冷媒的排放怎麼算」，看新的工具說明有沒有讓它想到 `refrigerant_blend`。
2. **Claude Directory 送件。** 表單要由你填。還沒準備的有：支援信箱、示範影片或截圖、公司資訊、服務條款頁。表單的欄位名稱與字數限制沒有查證過。送件文件的對應版本已改成 0.2.3；第 6 節的連接器實測是在 0.2.2 做的，那一處照實保留。
3. **`calculate_batch` 與 `compare_emissions` 支援混合冷媒。** 已完成（0.2.4）。四個工具現在都接受 `refrigerant_blend`。
4. **WAF 規則的漂移檢查。** 限流規則只存在 Cloudflare，repo 裡沒有，也沒有自動檢查。讀取規則需要另外的 API token，wrangler 的登入權杖讀不到。
5. **Smithery 發布。** 還沒設定。`twse-mcp` 已經有，可以參考。
6. **確認「hreflang 只放 `<head>` 就夠」。** 兩個專案的 sitemap 都拿掉了語系連結，依據是我對 Google 文件的理解，這一輪沒有重新查證。之後若在 Search Console 看到語系相關的警告，先看這裡。

## 還沒驗證的事

- 真實 AI 用戶端在對話中的行為（見上面第 1 項）。
- 實體手機上的版面，以及社群平台對分享圖的預覽。
- 你自己的 Chrome 視窗顯示 sitemap 的樣子。驗證用的是無頭 Chrome，XML 檢視器是同一套，但那個視窗我沒有看過。
- 新的工具說明有沒有真的讓 AI 更常搜尋冷媒。驗證的只有文字正確送到用戶端。

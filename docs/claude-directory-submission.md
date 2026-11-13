# Claude Directory 送件內容

這份文件收集送件時要填的內容，每一段都可以直接複製。整理日期：2026-11-13，對應版本 0.2.3。

表單的實際欄位名稱與字數限制，這份文件沒有查證。內容依「名稱、簡介、端點、隱私權頁、工具、示範問句」整理，並準備了長短兩種簡介，方便依欄位長度挑選。

所有數字與行為都在 2026-11-13 對正式環境實測過。服務更新後要重新核對，尤其是工具數量與示範問句的答案。

## 1. 服務名稱

```
Taiwan Carbon Open Data (Unofficial)
```

中文名稱：

```
台灣碳排係數與碳排計算（非官方）
```

名稱裡的「Unofficial／非官方」請保留。這個服務不是政府網站，與資料提供機關沒有隸屬關係。

## 2. 簡介

### 一句話（英文，99 個字元，與官方 MCP Registry 上的說明相同）

```
Unofficial. Taiwan government emission factors for AI: electricity, fuels, refrigerants, inventory.
```

### 一句話（中文）

```
非官方。讓 AI 查詢台灣政府公開的碳排放係數並計算排放量，附上來源、適用年度與計算依據。
```

### 短簡介（英文）

```
Look up emission factors published by Taiwan government agencies and calculate emissions with them. Every result carries the official source, the year the factor applies to, the factor version and the formula. When a factor is not found, the service says so instead of estimating. Unofficial, free, read-only, no account needed.
```

### 短簡介（中文）

```
查詢台灣政府機關公開的碳排放係數，並用這些係數計算排放量。每一筆結果都附官方來源、係數的適用年度、係數版本與計算公式。查不到係數時會明確說明，不會估算。非官方、免費、唯讀、不需註冊。
```

### 完整簡介（英文）

```
Taiwan Carbon Open Data lets Claude look up emission factors published by Taiwan government agencies and do traceable emission calculations.

What it covers:
- Electricity emission factors for 2005 to 2025 from the Energy Administration, including the three values published for 2025.
- Fuel combustion factors for 53 stationary fuels and common vehicle fuels, from the Ministry of Environment announcement of 5 February 2024.
- Refrigerant leakage, using the global warming potentials for 46 fluorinated gases in the same announcement. Blends such as R-410A are calculated from a composition the user supplies.
- Tap water factors from Taiwan Water Corporation and Taipei Water Department.
- About 1,200 product carbon footprint factors from the Ministry of Environment.

What it does with them:
- Calculates emissions for one activity or many, with exact decimal arithmetic.
- Arranges results as a greenhouse gas inventory grouped by Scope 1, 2 and 3.
- Maps everyday descriptions such as "electricity bill" to candidate factors for the user to confirm.

How it stays honest:
- Factors come only from official sources. Nothing is estimated or filled in.
- A factor for another year is never substituted silently.
- Where official data needs an input the government does not publish, such as a fuel's heating value or a refrigerant leak rate, the service asks for it and does not assume a default.
- Totals that would mislead, such as adding CO2 to CO2e, are withheld with the reason.

This is an unofficial service run by taux.io. It is not affiliated with any government agency. Results are for reference and are not a certified inventory, third-party verification or a compliance guarantee.
```

### 完整簡介（中文）

```
台灣碳排係數與碳排計算讓 Claude 查詢台灣政府機關公開的碳排放係數，並做可追溯的排放量計算。

收錄範圍：
- 經濟部能源署 2005 至 2025 年度的電力排碳係數，包含 2025 年度公布的三個數值。
- 環境部 113 年 2 月 5 日公告的燃料燃燒係數：固定燃燒 53 種燃料與常用的車用燃料。
- 冷媒逸散：採用同一份公告中 46 種含氟氣體的溫暖化潛勢。R-410A 這類混合冷媒依使用者提供的成分比例計算。
- 台灣自來水公司與臺北自來水事業處的每度水排放量。
- 環境部約 1,200 筆產品碳足跡係數。

可以做的事：
- 計算單筆或多筆活動的排放量，採精確十進位運算。
- 把結果依範疇一、二、三整理成溫室氣體盤查清冊的形式。
- 把「電費」這類日常說法對到候選係數，由使用者確認。

如何確保可信：
- 係數只來自官方來源，不估算、不補齊。
- 不會默默改用其他年度的係數。
- 官方資料需要政府沒有公布的數值時（例如燃料的熱值、冷媒的逸散率），服務會請使用者提供，不假設預設值。
- 會誤導的合計（例如把 CO2 與 CO2e 相加）不提供，並說明原因。

本服務由 taux.io 開發維運，是非官方服務，與任何政府機關沒有隸屬關係。計算結果僅供參考，不構成碳盤查認證、第三方查證或法定合規保證。
```

## 3. 連線資訊

MCP 端點：

```
https://carbon.taux.io/mcp
```

| 項目 | 內容 |
|---|---|
| 傳輸方式 | Streamable HTTP（遠端 MCP），無狀態 |
| 認證 | 不需要。沒有帳號、API Key 或 OAuth |
| 費用 | 免費 |
| 存取權限 | 全部唯讀。沒有任何寫入或刪除的工具 |
| 支援的協定版本 | 2025 系列與 2026-07-28 |
| 健康檢查 | `https://carbon.taux.io/health` |

審核者測試時不需要測試帳號，直接連上端點即可。

## 4. 連結

隱私權政策：

```
https://carbon.taux.io/privacy
```

| 項目 | 網址 |
|---|---|
| 網站首頁 | https://carbon.taux.io/ |
| 英文首頁 | https://carbon.taux.io/en |
| 日文首頁 | https://carbon.taux.io/ja |
| 工具說明 | https://carbon.taux.io/tools |
| REST API 文件 | https://carbon.taux.io/api/docs |
| 給 AI 讀的說明 | https://carbon.taux.io/llms.txt |
| 原始碼（MIT 授權） | https://github.com/taux-io/carbon-mcp |
| 問題回報與聯絡 | https://github.com/taux-io/carbon-mcp/issues |
| 圖示（SVG） | https://carbon.taux.io/favicon.svg |
| 圖示（180×180 PNG） | https://carbon.taux.io/apple-touch-icon.png |
| 分享圖（1200×630 PNG） | https://carbon.taux.io/og.png |

官方 MCP Registry 上的條目名稱：

```
io.github.taux-io/carbon-mcp
```

### 隱私權摘要（表單若要求簡述）

英文：

```
No account, no cookies and no analytics. The service does not log or store what users ask or the arguments of tool calls. Cloudflare, the hosting provider, keeps per-request connection metadata (IP address, User-Agent, request headers, URL, status code) for at most 7 days, used only for troubleshooting and abuse prevention. The database holds only public government emission factors. Full policy: https://carbon.taux.io/privacy
```

中文：

```
不需帳號、不設 Cookie、沒有分析追蹤。服務不記錄也不保存使用者問的內容與工具參數。主機供應商 Cloudflare 會保存每個請求的連線中繼資料（IP、User-Agent、請求標頭、網址、狀態碼）最長 7 天，只用於排查問題與防止濫用。資料庫只有政府公開的排放係數。完整政策：https://carbon.taux.io/privacy
```

## 5. 工具清單

共 13 個工具，全部標示為唯讀（`readOnlyHint: true`、`destructiveHint: false`）。

| 工具名稱 | 英文說明 | 中文說明 |
|---|---|---|
| `ping` | Check that the service is up. | 確認服務是否正常。 |
| `list_data_sources` | List the official data sources and their status. | 列出已整合的官方資料來源與狀態。 |
| `search_emission_factors` | Search emission factors by keyword, category or year. | 以關鍵字、類別、年度搜尋排放係數。 |
| `match_activity` | Map an activity description to candidate factors for confirmation. | 把活動描述對到候選係數，列出適用條件供確認。 |
| `get_emission_factor` | Get one factor in full, with its usage limits. | 取得單一係數的完整資訊與使用限制。 |
| `get_electricity_factor` | Get Taiwan's electricity emission factor for a year. | 查詢指定年度的台灣電力排碳係數。 |
| `calculate_emissions` | Calculate emissions for one activity with an official factor. | 用官方係數計算單一活動的排放量。 |
| `calculate_batch` | Calculate several activities; totals only when compatible. | 批次計算多筆活動，條件相容時才給合計。 |
| `build_inventory` | Calculate activities and summarise them by Scope 1, 2 and 3. | 計算多筆活動並依範疇一、二、三彙整成清冊。 |
| `compare_emissions` | Compare two results, separating activity and factor effects. | 比較兩筆排放量，區分活動量與係數的影響。 |
| `list_factor_versions` | List a factor's version history. | 列出係數的歷史版本。 |
| `check_factor_updates` | Show each source's sync and update status. | 查看各資料來源的同步與更新狀態。 |
| `get_methodology` | Explain the methods, scope and data limits. | 說明計算方法、適用範圍與資料限制。 |

純文字版本（表單不支援表格時使用）：

```
ping - Check that the service is up.
list_data_sources - List the official data sources and their status.
search_emission_factors - Search emission factors by keyword, category or year.
match_activity - Map an activity description to candidate factors for confirmation.
get_emission_factor - Get one factor in full, with its usage limits.
get_electricity_factor - Get Taiwan's electricity emission factor for a year.
calculate_emissions - Calculate emissions for one activity with an official factor.
calculate_batch - Calculate several activities; totals only when compatible.
build_inventory - Calculate activities and summarise them by Scope 1, 2 and 3.
compare_emissions - Compare two results, separating activity and factor effects.
list_factor_versions - List a factor's version history.
check_factor_updates - Show each source's sync and update status.
get_methodology - Explain the methods, scope and data limits.
```

## 6. 三個示範問句

三題分別展示查詢、計算、以及「缺資料時先問而不是猜」。預期結果有兩次驗證：先以 REST API 直接呼叫，再透過 Claude 的 MCP 連接器實際呼叫工具（見本節最後的「連接器實測紀錄」）。Claude 實際的措辭會不同，但數字與行為應該一致。

### 示範一：查詢係數

英文：

```
What is Taiwan's electricity emission factor for 2025?
```

中文：

```
2025 年台灣每度電的排碳係數是多少？
```

預期：回答三個數值並說明差別，不會只挑一個。

- 產業盤查使用：0.466 公斤CO2e/度
- 表燈非營業與包燈用戶：0.471 公斤CO2e/度
- 公用售電業整體平均：0.467 公斤CO2e/度

會附上經濟部能源署的來源網址，並說明要依電價種類選擇。使用的工具：`get_electricity_factor`。

### 示範二：計算排放量

英文：

```
My office used 12,000 kWh of electricity in 2025. How much is that in emissions?
```

中文：

```
我的辦公室 2025 年用電 12,000 度，碳排放量是多少？
```

預期：5,592 kgCO2e（5.592 公噸），使用產業盤查的係數 0.466。回答會列出公式、係數的適用年度與版本、來源網址，並說明這是非官方的計算結果。使用的工具：`get_electricity_factor`、`calculate_emissions`。

### 示範三：缺資料時先問

英文：

```
Our office air conditioner uses R-32 refrigerant with a 20 kg charge. What are the emissions from leakage?
```

中文：

```
我們辦公室的冷氣用 R-32 冷媒，填充量 20 公斤，逸散的排放量是多少？
```

預期：Claude 不會直接給數字，而是先問年逸散率。官方只公布各類設備逸散率的範圍（住宅及商業建築空調每年 1% 至 10%），沒有單一預設值，服務不會代為假設。

使用者回答「5%」之後，結果是 677 kgCO2e（20 公斤 × 5% × GWP 677），並註明 5% 落在官方範圍內。使用的工具：`search_emission_factors`、`calculate_emissions`。

這一題最能說明這個服務與「AI 憑記憶回答」的差別。

### 連接器實測紀錄

2026-11-13 由 Claude Code 透過 claude.ai 的「Taiwan Carbon Open Data」連接器呼叫正式環境（版本 0.2.2），共六次工具呼叫：

| 示範 | 工具與參數 | 結果 |
|---|---|---|
| 一 | `get_electricity_factor`，`year: 2025` | 回三筆：產業盤查 0.466、表燈非營業與包燈 0.471、公用售電業 0.467。附說明「本服務不會代為選擇」，公告日期 2026-06-02，來源為能源署 |
| 二 | `calculate_emissions`，產業盤查係數、12000 kWh、`year: 2025` | `emissions_kg: "5592"`，`emissions_t: "5.592"`，公式 `12000 kWh × 0.466 kgCO2e/kWh = 5592 kgCO2e`，係數版本 1 |
| 三 | `search_emission_factors`，`query: "R-32"` | 剛好一筆：二氟甲烷（HFC-32），GWP 677 |
| 三 | `calculate_emissions`，HFC-32、20 kg，**不給任何計算依據** | 工具錯誤 `missing_refrigerant_basis`。訊息要求說明數量是逸散量還是填充量，並附上官方八類設備的逸散率範圍 |
| 三 | 同上，只說是填充量（`basis: "charge"`），**不給逸散率** | 工具錯誤 `invalid_leak_rate`。訊息說明官方只有範圍、沒有預設值 |
| 三 | 同上，加上 `leak_rate_percent: 5` 與設備類型「住宅及商業建築空調」 | `emissions_kg: "677"`，公式 `填充量 20 kg × 年逸散率 5% × GWP 677 = 677 kgCO2e`，並註明 5% 在官方範圍 1% 至 10% 內 |

示範三有兩種錯誤代碼，差別在缺的是什麼：

- 完全沒說數量的依據：`missing_refrigerant_basis`。
- 說了是填充量但沒給逸散率：`invalid_leak_rate`。

兩種情況服務都不會算出數字，Claude 只能回頭問使用者。

## 7. 送件前的檢查

送件當天重新確認：

```bash
npm run smoke -- https://carbon.taux.io          # 應全部通過，工具數 13
npm run check-concepts -- https://carbon.taux.io
npm run check-registry                           # 應顯示與 server.json 一致
curl -s https://carbon.taux.io/health            # 版本與 database: ok
```

## 8. 沒有準備的項目

表單若要求下列項目，目前沒有現成的內容：

- **客服電子郵件。** 目前的聯絡管道只有 GitHub issues。
- **示範影片或畫面截圖。**
- **測試帳號。** 不需要，服務沒有帳號。
- **公司或法人資訊。** 文件裡只寫了由 taux.io 開發維運。
- **服務條款頁面。** 目前只有隱私權政策，以及首頁與每個工具回應裡的免責聲明。

三個示範問句已透過 MCP 連接器實際呼叫過工具，結果在第 6 節的「連接器實測紀錄」。那次測試驗證的是連接器與工具的行為。它沒有驗證的是：一個全新的 Claude 對話收到自然語言的問句時，會不會自己選對工具、會不會在示範三先問逸散率而不是自行假設一個值。執行測試的 AI 事先知道預期的流程，所以這一點仍要由人在 Claude 的對話介面親自問一遍才能確認。

# Privacy Policy / 隱私權政策

The full, current policy is served at **https://carbon.taux.io/privacy** (Traditional Chinese with an English summary).
完整、最新的版本在 **https://carbon.taux.io/privacy**（繁體中文，附英文摘要）。

Summary / 摘要：

- No account, no cookies, no analytics or tracking code on the web pages.
  不需帳號、不設 Cookie，網頁上沒有分析或追蹤程式碼。
- What you ask and the arguments of MCP tool calls are not logged or stored.
  不記錄、不保存你問的內容與 MCP 工具參數。
- Cloudflare Workers Logs keep per-request connection metadata (IP and derived location, network, User-Agent
  and request headers, which may include the MCP tool name, URL, status) for at most **7 days**, used only for
  troubleshooting and abuse prevention; never sold or shared.
  Cloudflare 會保存每個請求的連線中繼資料（IP 與推估位置、網路業者、User-Agent 與請求標頭，可能含工具名稱，網址、狀態碼）最長 **7 天**，
  只用於排查問題與防止濫用；不出售、不分享。
- A GET call to the REST API carries its query string in the URL, so it appears in those logs. POST bodies and MCP tool arguments do not.
  以 GET 呼叫 REST API 時，查詢字串是網址的一部分，會出現在上述日誌中；POST 的內容與 MCP 工具參數不會。
- Lookups and calculations read only the service's own database. Government sources are contacted only by a daily scheduled job and receive nothing about you.
  查詢與計算只讀本服務自己的資料庫；向政府來源的連線只發生在每日排程，不會帶上任何與你有關的資訊。

Contact / 聯絡：https://github.com/taux-io/carbon-mcp/issues

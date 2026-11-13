/**
 * Worker 入口。四條路：
 * - 靜態頁面（首頁、工具說明、API 文件、llms.txt…）：路由表白名單。
 * - /health、/api/v1/*：REST，唯讀。
 * - /mcp：MCP（Streamable HTTP，無狀態，不用 Durable Objects）。
 * - scheduled：資料同步。資料庫的寫入只發生在這裡，HTTP 進不來。
 */
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

import { handleApi, readBounded } from "./api";
import { APPLE_ICON_BASE64, FAVICON_ICO_BASE64, FAVICON_SVG } from "./icons";
import { OG_IMAGE_BASE64 } from "./og-image";
import { ATTRIBUTION, ping, SERVICE_NAME, VERSION } from "./service";
import { API_DOCS_HTML, COPY_SCRIPT_HASH, LLMS_FULL_TXT, LLMS_TXT, PRIVACY_HTML, renderPage, ROBOTS_TXT, SITEMAP_XML, TERMS_HTML, TOOLS_HTML } from "./site";
import { runScheduled } from "./sync";
import { TOOLS } from "./tools";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB?: D1Database;
  MOENV_API_KEY?: string;
  RATE_LIMITER?: RateLimiter;
}

const MCP_ROUTE = "/mcp";

const INSTRUCTIONS = [
  "Taiwan Carbon Open Data (unofficial): official Taiwan government emission factors and traceable emission calculations.",
  "台灣碳排係數與碳排計算（非官方）。使用方式：",
  "1. 先用 search_emission_factors 或 get_electricity_factor 找到係數 ID，再用 calculate_emissions 計算。請勿自行猜測係數 ID 或係數數值。",
  "2. 查不到係數時，請如實告訴使用者查不到，不要用記憶中的數值代替。",
  "3. 使用者指定年度時只用該年度的係數；工具回報年度不符時，請讓使用者選擇，不要自行改用其他年度。",
  "4. 燃料燃燒的計算需要使用者提供低位熱值，請向使用者詢問，不要自行假設。",
  "5. 回答時請附上工具回傳的來源網址、適用年度與係數版本，並說明這是非官方服務的計算結果，不構成碳盤查認證或查證。",
  ATTRIBUTION,
].join("\n");

/** 工具回應是不縮排的 JSON 字串：整段會進模型的 context，縮排只是多花 token。 */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const toolError = (value: unknown) => ({ ...json(value), isError: true });
const isFailure = (v: unknown) => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function createServer(db: D1Database | undefined): McpServer {
  const server = new McpServer({ name: SERVICE_NAME, title: "Taiwan Carbon Open Data (Unofficial)", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.shape, annotations: { ...READ_ONLY, title: tool.title } },
      async (args: unknown) => {
        if (!db) return toolError({ ok: false, error: { code: "unavailable", message: "資料庫尚未設定。" } });
        try {
          const result = await tool.run(args as never, { db, now: new Date() });
          return isFailure(result) ? toolError(result) : json(result);
        } catch (e) {
          console.error(JSON.stringify({ event: "tool_error", tool: tool.name, error: e instanceof Error ? e.message : String(e) }));
          return toolError({ ok: false, error: { code: "internal_error", message: "服務暫時無法處理這個請求。" } });
        }
      },
    );
  }
  return server;
}

const SITE_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; " +
    `frame-ancestors 'none'; script-src 'sha256-${COPY_SCRIPT_HASH}'`,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cache-control": "public, max-age=600, s-maxage=3600",
};

const HTML = "text/html; charset=utf-8";

/** 只有列在這裡的路徑會回靜態內容；首頁不是 catch-all，未知路徑一律 404。 */
/** base64 常數在模組載入時解一次；每個請求重解只是浪費 CPU。 */
const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// 圖只隨部署改變，而抓取端（Slack、X、Discord…）會重複來拿，所以放長快取。
const IMAGE_CACHE = "public, max-age=86400, s-maxage=604800";

const STATIC_ROUTES: Record<string, { body: string | Uint8Array; type: string; cache?: string }> = {
  "/og.png": { body: decode(OG_IMAGE_BASE64), type: "image/png", cache: IMAGE_CACHE },
  "/favicon.svg": { body: FAVICON_SVG, type: "image/svg+xml", cache: IMAGE_CACHE },
  // 瀏覽器與爬蟲不讀 <link> 時會直接來要 /favicon.ico。
  "/favicon.ico": { body: decode(FAVICON_ICO_BASE64), type: "image/x-icon", cache: IMAGE_CACHE },
  "/apple-touch-icon.png": { body: decode(APPLE_ICON_BASE64), type: "image/png", cache: IMAGE_CACHE },
  "/": { body: renderPage("zh"), type: HTML },
  "/en": { body: renderPage("en"), type: HTML },
  "/ja": { body: renderPage("ja"), type: HTML },
  "/tools": { body: TOOLS_HTML, type: HTML },
  "/api/docs": { body: API_DOCS_HTML, type: HTML },
  "/privacy": { body: PRIVACY_HTML, type: HTML },
  "/terms": { body: TERMS_HTML, type: HTML },
  "/llms.txt": { body: LLMS_TXT, type: "text/markdown; charset=utf-8" },
  "/llms-full.txt": { body: LLMS_FULL_TXT, type: "text/markdown; charset=utf-8" },
  "/robots.txt": { body: ROBOTS_TXT, type: "text/plain; charset=utf-8" },
  "/sitemap.xml": { body: SITEMAP_XML, type: "application/xml; charset=utf-8" },
};

const MAX_MCP_BYTES = 256 * 1024;

const rejection = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { status });

/**
 * /mcp 的 POST 進 SDK 之前過兩道：body 大小上限，然後拒絕 JSON-RPC 批次。
 * 批次在舊版協定的處理路徑會把每個元素同時分派、沒有節流，而 MCP 自 2025-06-18 起已把批次移出規範。
 */
async function guardMcpBody(request: Request): Promise<Response | Request> {
  if (request.method !== "POST" || !request.body) return request;
  const bytes = await readBounded(request, MAX_MCP_BYTES);
  if (!bytes) return rejection(413, `請求過大：/mcp 的請求 body 上限是 ${MAX_MCP_BYTES / 1024} KB。`);
  if (new TextDecoder().decode(bytes).trimStart().startsWith("[")) {
    return rejection(400, "不支援 JSON-RPC 批次（MCP 2025-06-18 起已移出規範）。請一次送一個請求。");
  }
  // signal 要帶過去：SDK 靠它在用戶端斷線時中止進行中的工作。
  return new Request(request.url, { method: "POST", headers: request.headers, body: bytes, signal: request.signal });
}

/** 依來源 IP 限流。沒有綁定（本機測試）時不限。 */
async function rateLimited(request: Request, env: Env): Promise<boolean> {
  if (!env.RATE_LIMITER) return false;
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  return !(await env.RATE_LIMITER.limit({ key })).success;
}

const TOO_MANY = "請求過於頻繁，請稍後再試。";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" || request.method === "HEAD") {
      const route = STATIC_ROUTES[path];
      if (route) {
        return new Response(request.method === "HEAD" ? null : route.body, {
          headers: { "content-type": route.type, ...SITE_HEADERS, ...(route.cache ? { "cache-control": route.cache } : {}) },
        });
      }
      if (path === "/health") {
        let database = "not_configured";
        if (env.DB) {
          try {
            const row = await env.DB.prepare("SELECT count(*) AS n FROM emission_factors").first<{ n: number }>();
            database = row && row.n > 0 ? "ok" : "empty";
          } catch {
            database = "error";
          }
        }
        return Response.json({ ...ping(new Date()), database }, { status: database === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
      }
    }

    if (path.startsWith("/api/")) {
      if (await rateLimited(request, env)) {
        return Response.json({ ok: false, error: { code: "rate_limited", message: TOO_MANY } }, { status: 429, headers: { "retry-after": "60" } });
      }
      return handleApi(request, env.DB, new Date());
    }

    if (path === MCP_ROUTE) {
      if (await rateLimited(request, env)) return rejection(429, TOO_MANY);
      const guarded = await guardMcpBody(request);
      if (guarded instanceof Response) return guarded;
      // handler 與 server 每個請求建一次：SDK 的 handler 持有進行中請求與訂閱的狀態，
      // 提到模組層級會讓那些狀態跟著 isolate 活，任何匿名用戶端都能把上限塞滿。
      return createMcpHandler(() => createServer(env.DB), { legacy: "stateless", corsOptions: { methods: "POST, OPTIONS" } })(guarded, env, ctx);
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },

  /** 排程同步（見 wrangler.jsonc 的 triggers）。只有排程會呼叫這裡。 */
  async scheduled(_controller, env) {
    if (!env.DB) return;
    const outcomes = await runScheduled(env.DB, env);
    for (const [job, outcome] of Object.entries(outcomes)) console.log(JSON.stringify({ job, ...outcome }));
    const failed = Object.entries(outcomes).filter(([, o]) => o.status === "failed").map(([job]) => job);
    if (failed.length) throw new Error(`同步失敗：${failed.join("、")}`);
  },
} satisfies ExportedHandler<Env>;

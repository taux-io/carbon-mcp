/**
 * REST API（/api/v1/*）。只做三件事：解析與驗證參數、呼叫服務層、把結果包成 HTTP 回應。
 * 查詢與計算的邏輯全在 service.ts，與 MCP 工具共用。全部唯讀。
 */
import { z } from "zod";

import {
  calculateBatch, calculateOne, electricity, factorDetail, factorVersions, listDataSources, search, updateStatus,
} from "./service";
import { batchShape, calcSchema, electricityShape, searchShape } from "./tools";

/** 瀏覽器端的跨來源呼叫只開給自己的網站與本機開發；伺服器對伺服器的呼叫不受 CORS 影響。 */
const ALLOWED_ORIGINS = new Set(["https://carbon.taux.io", "http://localhost:8787", "http://127.0.0.1:8787"]);

export const MAX_API_BODY_BYTES = 64 * 1024;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return { vary: "origin" };
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  factor_not_found: 404,
  no_factor_for_year: 404,
  not_found: 404,
  invalid_request: 400,
  invalid_quantity: 400,
  method_not_allowed: 405,
  payload_too_large: 413,
};

type Failure = { ok: false; error: { code: string; message: string; details?: unknown } };
const isFailure = (v: unknown): v is Failure => typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false;
const failure = (code: string, message: string, details?: unknown): Failure => ({ ok: false, error: { code, message, ...(details ? { details } : {}) } });

/** 讀取 body 並限制大小：邊讀邊數，不相信 content-length。超過上限回 null。 */
export async function readBounded(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length")) > max) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** 查詢字串都是字串；要數字的欄位先轉型再交給與 MCP 相同的 schema 驗證。 */
function queryObject(url: URL, numeric: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams) out[k] = numeric.includes(k) && /^-?\d+$/.test(v) ? Number(v) : v;
  return out;
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | Failure {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  return failure("invalid_request", "參數不正確。", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

async function jsonBody(request: Request): Promise<unknown | Failure> {
  const bytes = await readBounded(request, MAX_API_BODY_BYTES);
  if (!bytes) return failure("payload_too_large", `請求過大：body 上限是 ${MAX_API_BODY_BYTES / 1024} KB。`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return failure("invalid_request", "body 必須是 JSON。");
  }
}

const toRequest = (a: z.infer<typeof calcSchema>) => ({
  factor_id: a.factor_id,
  quantity: a.quantity,
  quantity_unit: a.quantity_unit,
  year: a.year,
  context: a.optional_context,
  factor_version: a.factor_version,
});

async function route(request: Request, url: URL, db: D1Database, now: Date): Promise<unknown> {
  const path = url.pathname.replace(/\/+$/, "");
  const get = request.method === "GET" || request.method === "HEAD";
  const post = request.method === "POST";

  if (path === "/api/v1/sources" && get) return listDataSources(db);
  if (path === "/api/v1/status" && get) return updateStatus(db);

  if (path === "/api/v1/factors" && get) {
    const p = parse(z.object(searchShape), queryObject(url, ["year", "limit", "offset"]));
    return isFailure(p) ? p : search(db, p);
  }

  const one = /^\/api\/v1\/factors\/([^/]+)(\/versions)?$/.exec(path);
  if (one && get) {
    const id = decodeURIComponent(one[1]);
    if (one[2]) return factorVersions(db, id);
    const v = url.searchParams.get("version");
    if (v !== null && !/^[1-9]\d*$/.test(v)) return failure("invalid_request", "version 必須是正整數。");
    return factorDetail(db, id, v === null ? undefined : Number(v));
  }

  if (path === "/api/v1/electricity" && get) {
    const p = parse(z.object(electricityShape), queryObject(url, ["year"]));
    return isFailure(p) ? p : electricity(db, p.year, p.usage_type);
  }

  if (path === "/api/v1/calculate" && post) {
    const body = await jsonBody(request);
    if (isFailure(body)) return body;
    const p = parse(calcSchema, body);
    return isFailure(p) ? p : calculateOne(db, toRequest(p), now);
  }

  if (path === "/api/v1/calculate/batch" && post) {
    const body = await jsonBody(request);
    if (isFailure(body)) return body;
    const p = parse(z.object(batchShape), body);
    return isFailure(p) ? p : calculateBatch(db, p.items.map(toRequest), now);
  }

  const known = ["/api/v1/sources", "/api/v1/status", "/api/v1/factors", "/api/v1/electricity", "/api/v1/calculate", "/api/v1/calculate/batch"];
  if (known.includes(path) || one) return failure("method_not_allowed", "這個路徑不支援此 HTTP 方法。");
  return failure("not_found", "沒有這個 API 路徑。文件見 /api/docs。");
}

export async function handleApi(request: Request, db: D1Database | undefined, now: Date): Promise<Response> {
  const headers = { ...corsHeaders(request), "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!db) return Response.json(failure("unavailable", "資料庫尚未設定。"), { status: 503, headers });

  let result: unknown;
  try {
    result = await route(request, new URL(request.url), db, now);
  } catch (e) {
    // 資料庫或程式錯誤的細節只進日誌，不回給呼叫端。
    console.error(JSON.stringify({ event: "api_error", path: new URL(request.url).pathname, error: e instanceof Error ? e.message : String(e) }));
    return Response.json(failure("internal_error", "服務暫時無法處理這個請求。"), { status: 500, headers });
  }
  const status = isFailure(result) ? (STATUS_BY_CODE[result.error.code] ?? 422) : 200;
  return Response.json(result, { status, headers });
}

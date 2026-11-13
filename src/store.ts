/**
 * D1 存取層。
 *
 * 寫入只有 upsertSources 與 upsertFactors 兩個入口，而且只有排程（scheduled）會呼叫它們；
 * HTTP 與 MCP 的路徑只用下半部的查詢函式。
 */
import type { DataSource, Factor, SourceDocument, StoredFactor } from "./types";
import { normalizeDeclaredUnit } from "./units";

const JSON_COLUMNS = ["aliases", "components", "usage_notes", "original"] as const;

const FACTOR_COLUMNS = [
  "id", "source_id", "document_id", "source_record_id", "name", "name_en", "aliases", "category", "factor_type",
  "variant", "gas_basis", "value", "components", "numerator_unit", "denominator_unit", "original_unit",
  "reference_year", "announcement_year", "announcement_date", "effective_from", "effective_to", "scope",
  "lifecycle_boundary", "boundary_basis", "methodology", "gwp_version", "calculability", "usage_notes",
  "source_url", "original",
] as const;

type Row = Record<string, unknown>;

function toRow(f: Factor): Row {
  const row: Row = {};
  for (const c of FACTOR_COLUMNS) {
    const v = (f as unknown as Row)[c];
    row[c] = (JSON_COLUMNS as readonly string[]).includes(c) ? (v == null ? null : JSON.stringify(v)) : (v ?? null);
  }
  return row;
}

function fromRow(row: Row): StoredFactor {
  const out: Row = { ...row };
  for (const c of JSON_COLUMNS) out[c] = row[c] == null ? null : JSON.parse(row[c] as string);
  delete out.search_text;
  return out as unknown as StoredFactor;
}

/** 搜尋用的文字：名稱、英文名、別名，小寫。 */
const searchText = (f: Factor) => [f.name, f.name_en ?? "", ...f.aliases].join(" ").toLowerCase();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 係數內容的雜湊。鍵的順序固定（FACTOR_COLUMNS），所以同樣的內容一定得到同樣的雜湊。 */
export const contentHash = (f: Factor) => sha256(JSON.stringify(FACTOR_COLUMNS.map((c) => (f as unknown as Row)[c] ?? null)));

/** D1 的 batch 是一個交易；每批的語句數保守一點。 */
const BATCH_SIZE = 40;

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) await db.batch(statements.slice(i, i + BATCH_SIZE));
}

export async function upsertSources(db: D1Database, sources: DataSource[], documents: SourceDocument[]): Promise<void> {
  const statements = [
    ...sources.map((s) =>
      db
        .prepare(
          `INSERT INTO data_sources (id, organization, dataset_code, dataset_name, official_url, api_url, license, license_note, update_frequency, ingestion, status, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET organization=excluded.organization, dataset_code=excluded.dataset_code,
             dataset_name=excluded.dataset_name, official_url=excluded.official_url, api_url=excluded.api_url,
             license=excluded.license, license_note=excluded.license_note, update_frequency=excluded.update_frequency,
             ingestion=excluded.ingestion, notes=excluded.notes,
             status=CASE WHEN data_sources.status = 'active' THEN 'active' ELSE excluded.status END`,
        )
        .bind(s.id, s.organization, s.dataset_code, s.dataset_name, s.official_url, s.api_url, s.license, s.license_note, s.update_frequency, s.ingestion, s.status, s.notes),
    ),
    ...documents.map((d) =>
      db
        .prepare(
          `INSERT INTO source_documents (id, source_id, title, url, published_date, document_ref, sha256, format, reviewed_at, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, url=excluded.url, published_date=excluded.published_date,
             document_ref=excluded.document_ref, sha256=excluded.sha256, format=excluded.format,
             reviewed_at=excluded.reviewed_at, notes=excluded.notes`,
        )
        .bind(d.id, d.source_id, d.title, d.url, d.published_date, d.document_ref, d.sha256, d.format, d.reviewed_at, d.notes),
    ),
  ];
  await runBatches(db, statements);
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * 寫入係數，保留歷史。
 * - 內容沒變：不動（重跑幾次結果都一樣）。
 * - 新的：version 1。
 * - 內容變了：version + 1；舊版本留在 factor_versions，不會被覆蓋。
 * 每筆係數的「更新目前版本」與「新增歷史版本」在同一個 batch（交易）裡。
 */
export async function upsertFactors(db: D1Database, factors: Factor[], reason: string, now: Date): Promise<UpsertResult> {
  const ids = new Set(factors.map((f) => f.id));
  if (ids.size !== factors.length) throw new Error("係數 ID 重複，拒絕寫入。");

  const sourceIds = [...new Set(factors.map((f) => f.source_id))];
  const existing = new Map<string, { content_hash: string; version: number }>();
  for (const sourceId of sourceIds) {
    const { results } = await db
      .prepare("SELECT id, content_hash, version FROM emission_factors WHERE source_id = ?")
      .bind(sourceId)
      .all<{ id: string; content_hash: string; version: number }>();
    for (const r of results) existing.set(r.id, r);
  }

  const at = now.toISOString();
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
  const statements: D1PreparedStatement[] = [];
  const columns = [...FACTOR_COLUMNS, "search_text", "version", "status", "retrieved_at", "content_hash"];
  const insertSql = `INSERT OR REPLACE INTO emission_factors (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`;

  for (const f of factors) {
    const hash = await contentHash(f);
    const prev = existing.get(f.id);
    if (prev?.content_hash === hash) {
      result.unchanged++;
      continue;
    }
    const version = (prev?.version ?? 0) + 1;
    const row = toRow(f);
    const stored: StoredFactor = { ...f, version, status: "current", retrieved_at: at, content_hash: hash };
    statements.push(
      db.prepare(insertSql).bind(...FACTOR_COLUMNS.map((c) => row[c]), searchText(f), version, "current", at, hash),
      db
        .prepare("INSERT INTO factor_versions (factor_id, version, content_hash, payload, recorded_at, change_reason) VALUES (?,?,?,?,?,?)")
        .bind(f.id, version, hash, JSON.stringify(stored), at, prev ? reason : `首次匯入：${reason}`),
    );
    if (prev) result.updated++;
    else result.inserted++;
  }
  // 一筆係數的兩個語句必須在同一批：BATCH_SIZE 是偶數，語句成對加入，所以不會被切開。
  await runBatches(db, statements);
  return result;
}

// ---------------------------------------------------------------- 同步紀錄

export async function startJob(db: D1Database, sourceId: string, kind: "reviewed_import" | "api_sync" | "cross_check", now: Date): Promise<number> {
  const r = await db
    .prepare("INSERT INTO sync_jobs (source_id, kind, started_at, status) VALUES (?,?,?, 'running')")
    .bind(sourceId, kind, now.toISOString())
    .run();
  return Number(r.meta.last_row_id);
}

export interface JobOutcome {
  status: "success" | "failed" | "skipped" | "review_needed";
  records_ok?: number;
  records_failed?: number;
  records_changed?: number;
  error?: string | null;
  source_version?: string | null;
}

/** 結束一筆同步紀錄，並更新來源的健康狀態。失敗時不動係數，只標記資料可能過期。 */
export async function finishJob(db: D1Database, jobId: number, sourceId: string, outcome: JobOutcome, now: Date): Promise<void> {
  const at = now.toISOString();
  const health = outcome.status === "failed" ? "stale" : outcome.status === "review_needed" ? "review_needed" : "ok";
  const statements = [
    db
      .prepare("UPDATE sync_jobs SET finished_at=?, status=?, records_ok=?, records_failed=?, records_changed=?, error=?, source_version=? WHERE id=?")
      .bind(at, outcome.status, outcome.records_ok ?? 0, outcome.records_failed ?? 0, outcome.records_changed ?? 0, outcome.error ?? null, outcome.source_version ?? null, jobId),
  ];
  if (outcome.status !== "skipped") {
    statements.push(
      outcome.status === "success"
        ? db.prepare("UPDATE data_sources SET last_checked_at=?, last_success_at=?, health='ok', health_note=NULL WHERE id=?").bind(at, at, sourceId)
        : db.prepare("UPDATE data_sources SET last_checked_at=?, health=?, health_note=? WHERE id=?").bind(at, health, outcome.error ?? null, sourceId),
    );
  }
  await db.batch(statements);
}

// ---------------------------------------------------------------- 查詢

export async function getFactor(db: D1Database, id: string): Promise<StoredFactor | null> {
  const row = await db.prepare("SELECT * FROM emission_factors WHERE id = ?").bind(id).first<Row>();
  return row ? fromRow(row) : null;
}

/** 指定版本（重現過去的計算用）。 */
export async function getFactorVersion(db: D1Database, id: string, version: number): Promise<StoredFactor | null> {
  const row = await db.prepare("SELECT payload FROM factor_versions WHERE factor_id = ? AND version = ?").bind(id, version).first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as StoredFactor) : null;
}

export interface VersionEntry {
  version: number;
  recorded_at: string;
  change_reason: string;
  value: string | null;
  components: unknown;
  is_current: boolean;
}

export async function listVersions(db: D1Database, id: string): Promise<VersionEntry[]> {
  const { results } = await db
    .prepare("SELECT version, recorded_at, change_reason, payload FROM factor_versions WHERE factor_id = ? ORDER BY version DESC")
    .bind(id)
    .all<{ version: number; recorded_at: string; change_reason: string; payload: string }>();
  return results.map((r, i) => {
    const p = JSON.parse(r.payload) as StoredFactor;
    return { version: r.version, recorded_at: r.recorded_at, change_reason: r.change_reason, value: p.value, components: p.components, is_current: i === 0 };
  });
}

export interface SearchParams {
  query?: string;
  category?: string;
  factor_type?: string;
  year?: number;
  unit?: string;
  limit: number;
  offset: number;
}

export const MAX_LIMIT = 50;

/**
 * 搜尋。query 以空白切成關鍵字，每個關鍵字都要出現在名稱或別名裡；
 * 另外，如果整句話裡包含某筆係數的中文別名（「辦公室一年的用電」含「用電」），也算符合。
 * 這條只認兩個字以上的中文別名：單字（「水」會配到「水泥」）與英文（"water" 會配到 "wastewater"）
 * 當成子字串比對會給出不相干的結果，而這個服務的承諾是查不到就說查不到。
 */
export async function searchFactors(db: D1Database, p: SearchParams): Promise<{ total: number; items: StoredFactor[] }> {
  const where: string[] = ["status = 'current'"];
  const binds: unknown[] = [];
  const q = p.query?.trim().toLowerCase();
  if (q) {
    const tokens = q.split(/\s+/).slice(0, 8);
    const all = tokens.map(() => "search_text LIKE ? ESCAPE '\\'").join(" AND ");
    where.push(`((${all}) OR EXISTS (SELECT 1 FROM json_each(emission_factors.aliases) WHERE length(json_each.value) >= 2 AND json_each.value GLOB '*[^ -~]*' AND instr(?, lower(json_each.value)) > 0))`);
    binds.push(...tokens.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`), q);
  }
  if (p.category) (where.push("category = ?"), binds.push(p.category));
  if (p.factor_type) (where.push("factor_type = ?"), binds.push(p.factor_type));
  if (p.year !== undefined) {
    where.push("(reference_year = ? OR (reference_year IS NULL AND (effective_from IS NULL OR substr(effective_from,1,4) <= ?)))");
    binds.push(p.year, String(p.year));
  }
  if (p.unit) {
    const unit = normalizeDeclaredUnit(p.unit) ?? p.unit;
    where.push("(denominator_unit = ? OR original_unit LIKE ?)");
    binds.push(unit, `%${p.unit}%`);
  }
  const clause = where.join(" AND ");
  const limit = Math.min(Math.max(1, p.limit), MAX_LIMIT);
  const offset = Math.max(0, p.offset);

  const total = await db.prepare(`SELECT count(*) AS n FROM emission_factors WHERE ${clause}`).bind(...binds).first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT * FROM emission_factors WHERE ${clause}
       ORDER BY (lower(name) = ?) DESC, reference_year DESC NULLS LAST, id LIMIT ? OFFSET ?`,
    )
    .bind(...binds, q ?? "", limit, offset)
    .all<Row>();
  return { total: total?.n ?? 0, items: results.map(fromRow) };
}

export async function electricityFactors(db: D1Database, year: number): Promise<StoredFactor[]> {
  const { results } = await db
    .prepare("SELECT * FROM emission_factors WHERE category = 'electricity' AND reference_year = ? AND status = 'current' ORDER BY id")
    .bind(year)
    .all<Row>();
  return results.map(fromRow);
}

/** 同一類係數有哪些年度可用（年度不符時給使用者選）。 */
export async function availableYears(db: D1Database, factor: Pick<StoredFactor, "source_id" | "category" | "variant">): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT reference_year AS y FROM emission_factors WHERE source_id = ? AND category = ? AND reference_year IS NOT NULL AND status = 'current' ORDER BY y")
    .bind(factor.source_id, factor.category)
    .all<{ y: number }>();
  return results.map((r) => r.y);
}

export interface SourceSummary extends DataSource {
  last_checked_at: string | null;
  last_success_at: string | null;
  health: string;
  health_note: string | null;
  factor_count: number;
}

export async function listSources(db: D1Database): Promise<SourceSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, (SELECT count(*) FROM emission_factors f WHERE f.source_id = s.id AND f.status = 'current') AS factor_count
       FROM data_sources s ORDER BY s.id`,
    )
    .all<SourceSummary>();
  return results;
}

export interface JobSummary {
  source_id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_ok: number;
  records_changed: number;
  error: string | null;
}

/** 每個來源、每種工作最近的一筆。 */
export async function latestJobs(db: D1Database): Promise<JobSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT source_id, kind, started_at, finished_at, status, records_ok, records_changed, error
       FROM sync_jobs WHERE id IN (SELECT max(id) FROM sync_jobs GROUP BY source_id, kind) ORDER BY source_id, kind`,
    )
    .all<JobSummary>();
  return results;
}

export async function documentsFor(db: D1Database, sourceId: string): Promise<SourceDocument[]> {
  const { results } = await db.prepare("SELECT * FROM source_documents WHERE source_id = ? ORDER BY id").bind(sourceId).all<SourceDocument>();
  return results;
}

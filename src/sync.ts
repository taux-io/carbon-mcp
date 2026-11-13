/**
 * 資料同步。只有排程（scheduled）會呼叫這裡，HTTP 請求進不來。
 *
 * 三種工作：
 * - importReviewed：把 data/reviewed.ts（經 git 審查的官方數值）寫進 D1。重跑不會改變任何東西。
 * - crossCheckElectricity：抓能源署的開放資料 CSV，與已審核的數值比對。只標記，不寫係數。
 * - syncCarbonFootprint：同步環境部 CFP_P_02。需要 API Key；資料有任何異常就整批放棄，保留上次成功的資料。
 */
import Big from "big.js";

import { DOCUMENTS, FACTORS, SOURCES } from "./data/reviewed";
import { finishJob, startJob, upsertFactors, upsertSources, type JobOutcome } from "./store";
import type { Factor } from "./types";
import { normalizeDeclaredUnit } from "./units";

export const USER_AGENT = "TaiwanCarbonOpenData/0.1 (+https://carbon.taux.io)";

type Fetch = typeof fetch;

async function withJob(
  db: D1Database,
  sourceId: string,
  kind: "reviewed_import" | "api_sync" | "cross_check",
  now: () => Date,
  work: () => Promise<JobOutcome>,
  secrets: string[] = [],
): Promise<JobOutcome> {
  const jobId = await startJob(db, sourceId, kind, now());
  let outcome: JobOutcome;
  try {
    outcome = await work();
  } catch (e) {
    outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  // 錯誤訊息會存進資料庫並由公開的狀態端點回傳；例外文字可能帶著含金鑰的網址，先遮掉。
  if (outcome.error) outcome = { ...outcome, error: redact(outcome.error, secrets) };
  await finishJob(db, jobId, sourceId, outcome, now());
  return outcome;
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[已遮蔽]").split(encodeURIComponent(secret)).join("[已遮蔽]");
  }
  return out.replace(/api_key=[^&\s"']+/gi, "api_key=[已遮蔽]");
}

export async function importReviewed(db: D1Database, now: () => Date = () => new Date()): Promise<Record<string, JobOutcome>> {
  await upsertSources(db, SOURCES, DOCUMENTS);
  const out: Record<string, JobOutcome> = {};
  for (const source of SOURCES.filter((s) => s.ingestion === "reviewed_import")) {
    const factors = FACTORS.filter((f) => f.source_id === source.id);
    out[source.id] = await withJob(db, source.id, "reviewed_import", now, async () => {
      const r = await upsertFactors(db, factors, "審核後匯入", now());
      return { status: "success", records_ok: factors.length, records_changed: r.inserted + r.updated, source_version: `reviewed ${DOCUMENTS[0].reviewed_at}` };
    });
  }
  return out;
}

/** 上游回 2xx 的 HTML 錯誤頁、或內容型別亂標，都遇過；所以一律先讀文字再自己判斷。 */
async function fetchText(fetcher: Fetch, url: string): Promise<string> {
  const res = await fetcher(url, { headers: { "user-agent": USER_AGENT, accept: "*/*" }, redirect: "manual" });
  if (!res.ok) throw new Error(`官方來源回應 HTTP ${res.status}（可能是來源故障，或擋下了 Cloudflare 的連線）。`);
  return res.text();
}

const ELECTRICITY_CSV = "https://www.moeaea.gov.tw/ECW/populace/opendata/wHandOpenData_File.ashx?set_id=13";
const CSV_YEAR = "西元年";
const CSV_VALUE = "電力排碳係數(公斤CO2e/度)";

/** 解析能源指標年資料 CSV，取出 年度 → 電力排碳係數。欄位不在就丟錯（來源結構變了）。 */
export function parseElectricityCsv(text: string): Map<number, string> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const yi = header.indexOf(CSV_YEAR);
  const vi = header.indexOf(CSV_VALUE);
  if (yi < 0 || vi < 0) throw new Error("能源署 CSV 的欄位結構與預期不同（找不到年度或電力排碳係數欄位）。");
  const out = new Map<number, string>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const year = Number(cells[yi]);
    const value = cells[vi];
    if (!Number.isInteger(year) || !/^\d+(\.\d+)?$/.test(value ?? "")) continue;
    out.set(year, value);
  }
  if (out.size === 0) throw new Error("能源署 CSV 沒有任何可用的列。");
  return out;
}

/** CSV 的數列對應公用售電業的數值：未劃分年度的單一值，或劃分年度的 utility_average。 */
function reviewedElectricity(): Map<number, string> {
  const out = new Map<number, string>();
  for (const f of FACTORS) {
    if (f.category === "electricity" && (f.variant === "single" || f.variant === "utility_average")) out.set(f.reference_year!, f.value!);
  }
  return out;
}

export async function crossCheckElectricity(db: D1Database, fetcher: Fetch = fetch, now: () => Date = () => new Date()): Promise<JobOutcome> {
  return withJob(db, "moea-electricity", "cross_check", now, async () => {
    const official = parseElectricityCsv(await fetchText(fetcher, ELECTRICITY_CSV));
    const reviewed = reviewedElectricity();
    const diffs: string[] = [];
    for (const [year, value] of official) {
      const ours = reviewed.get(year);
      if (ours === undefined) diffs.push(`${year} 年：官方有 ${value}，本服務尚未收錄`);
      else if (!new Big(ours).eq(value)) diffs.push(`${year} 年：官方 ${value}，本服務 ${ours}`);
    }
    if (diffs.length) return { status: "review_needed", records_ok: official.size, records_changed: diffs.length, error: `官方開放資料與已審核資料不一致，需人工審核：${diffs.join("；")}` };
    return { status: "success", records_ok: official.size };
  });
}

// ---------------------------------------------------------------- CFP_P_02

const CFP_API = "https://data.moenv.gov.tw/api/v2/cfp_p_02";
const CFP_PAGE = 1000;
const CFP_MAX_PAGES = 50;
/** 筆數比上次少超過這個比例就視為異常，不寫入。 */
const CFP_MAX_DROP = 0.2;

type CfpRecord = Record<string, string>;

/** 欄位名稱大小寫在文件與實際回應之間不一致，所以不分大小寫取值。 */
function field(record: Record<string, unknown>, name: string): string {
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const v = key ? record[key] : undefined;
  return v == null ? "" : String(v).trim();
}

/** 回應可能是陣列，也可能包在 { records: [...] } 裡；其他形狀一律視為異常。 */
export function parseCfpPage(text: string): CfpRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`環境部 API 回應不是 JSON：${text.slice(0, 60)}`);
  }
  const records = Array.isArray(data) ? data : (data as { records?: unknown })?.records;
  if (!Array.isArray(records)) throw new Error("環境部 API 的回應結構與預期不同（找不到紀錄陣列）。");
  return records as CfpRecord[];
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 來源沒有紀錄 ID；這四個欄位是最接近「同一筆係數」的鍵，但實測有十幾組相同而數值不同。 */
const cfpIdentity = (r: CfpRecord) => [field(r, "name"), field(r, "unit"), field(r, "departmentname"), field(r, "announcementyear")].join("|");

/**
 * `ambiguous`：同一批資料裡有別的紀錄與它的名稱、單位、發布單位、公告年份完全相同而數值不同。
 * 來源沒有提供區分依據，所以這種紀錄只供查詢。
 */
export async function cfpToFactor(record: CfpRecord, ambiguous = false): Promise<Factor> {
  const name = field(record, "name");
  const coe = field(record, "coe").replace(/,/g, "");
  const unit = field(record, "unit");
  const department = field(record, "departmentname");
  const year = field(record, "announcementyear");
  if (!name || !unit) throw new Error(`紀錄缺少必要欄位（名稱或宣告單位）：${JSON.stringify(record).slice(0, 120)}`);
  if (!/^\d+(\.\d+)?$/.test(coe)) throw new Error(`「${name}」的碳足跡數值不是數字：${coe || "（空白）"}`);
  const announcementYear = /^\d{4}$/.test(year) ? Number(year) : /^\d{2,3}$/.test(year) ? Number(year) + 1911 : null;
  const normalized = normalizeDeclaredUnit(unit);
  return {
    // 數值也進雜湊：來源沒有 ID，而且有同名同單位同年份、數值不同的紀錄，只有加上數值才分得開。
    // 代價是官方更正數值時，會表現為舊係數撤回、新係數出現，而不是同一筆係數的新版本。
    id: `cfp-${await shortHash([name, unit, department, year, coe].join("|"))}`,
    source_id: "moenv-cfp",
    document_id: null,
    source_record_id: null,
    name,
    name_en: null,
    aliases: [],
    category: "product_footprint",
    factor_type: "product_carbon_footprint",
    variant: department || null,
    gas_basis: "CO2e",
    value: coe,
    components: null,
    numerator_unit: "kg",
    denominator_unit: normalized,
    original_unit: unit,
    // 公告年份不是適用年度，所以 reference_year 留空。
    reference_year: null,
    announcement_year: announcementYear,
    announcement_date: null,
    effective_from: null,
    effective_to: null,
    scope: [field(record, "scpoe3_iso"), field(record, "scpoe3_ghg")].filter(Boolean).join("；") || null,
    lifecycle_boundary: "產品生命週期碳足跡（邊界依各係數的建置資料而定）。",
    boundary_basis: null,
    methodology: "經環境部審查通過之碳足跡排放係數。",
    gwp_version: null,
    calculability: normalized && !ambiguous ? "direct" : "lookup_only",
    usage_notes: [
      "這是產品碳足跡係數，不代表適合直接用於組織溫室氣體盤查，也不可與組織盤查的結果相加。",
      "「公告年份」不是係數的適用年度。",
      ...(normalized ? [] : [`宣告單位「${unit}」是以產品件數計或無法對應到標準單位，僅供查詢。`]),
      ...(ambiguous ? ["官方資料中有其他紀錄與這筆的名稱、單位、發布單位、公告年份完全相同而數值不同，來源沒有提供區分依據，所以僅供查詢。"] : []),
    ],
    source_url: "https://data.moenv.gov.tw/dataset/detail/CFP_P_02",
    original: record,
  };
}

export async function syncCarbonFootprint(db: D1Database, apiKey: string | undefined, fetcher: Fetch = fetch, now: () => Date = () => new Date()): Promise<JobOutcome> {
  return withJob(db, "moenv-cfp", "api_sync", now, async () => {
    if (!apiKey) return { status: "skipped", error: "未設定 MOENV_API_KEY，略過同步。" };

    const records: CfpRecord[] = [];
    for (let page = 0; page < CFP_MAX_PAGES; page++) {
      const url = `${CFP_API}?api_key=${encodeURIComponent(apiKey)}&limit=${CFP_PAGE}&offset=${page * CFP_PAGE}&format=json`;
      const rows = parseCfpPage(await fetchText(fetcher, url));
      records.push(...rows);
      if (rows.length < CFP_PAGE) break;
    }
    if (records.length === 0) throw new Error("環境部 API 回傳 0 筆，視為異常，不寫入。");

    const seen = new Map<string, number>();
    for (const r of records) seen.set(cfpIdentity(r), (seen.get(cfpIdentity(r)) ?? 0) + 1);
    const factors: Factor[] = [];
    for (const r of records) factors.push(await cfpToFactor(r, seen.get(cfpIdentity(r))! > 1));
    const ids = new Set(factors.map((f) => f.id));
    if (ids.size !== factors.length) {
      throw new Error(`有 ${factors.length - ids.size} 筆紀錄的所有欄位完全相同，視為來源異常；整批不寫入。`);
    }

    const before = await db.prepare("SELECT count(*) AS n FROM emission_factors WHERE source_id = 'moenv-cfp' AND status = 'current'").first<{ n: number }>();
    const previous = before?.n ?? 0;
    if (previous > 0 && factors.length < previous * (1 - CFP_MAX_DROP)) {
      throw new Error(`筆數從 ${previous} 降到 ${factors.length}，降幅超過 ${CFP_MAX_DROP * 100}%，視為異常，不寫入。`);
    }

    const r = await upsertFactors(db, factors, "環境部 CFP_P_02 同步", now());
    // 來源已移除的紀錄標為撤回，不刪除：用過它的計算仍可用 factor_id 加版本重現。重新出現的會恢復。
    await db
      .prepare("UPDATE emission_factors SET status = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 'current' ELSE 'withdrawn' END WHERE source_id = 'moenv-cfp'")
      .bind(JSON.stringify([...ids]))
      .run();
    await db.prepare("UPDATE data_sources SET status = 'active' WHERE id = 'moenv-cfp'").run();
    return { status: "success", records_ok: factors.length, records_changed: r.inserted + r.updated };
  }, apiKey ? [apiKey] : []);
}

export async function runScheduled(db: D1Database, env: { MOENV_API_KEY?: string }): Promise<Record<string, JobOutcome>> {
  const reviewed = await importReviewed(db);
  return {
    ...Object.fromEntries(Object.entries(reviewed).map(([k, v]) => [`import:${k}`, v])),
    "cross_check:moea-electricity": await crossCheckElectricity(db),
    "sync:moenv-cfp": await syncCarbonFootprint(db, env.MOENV_API_KEY),
  };
}

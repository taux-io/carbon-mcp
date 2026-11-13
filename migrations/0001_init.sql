-- Taiwan Carbon Open Data：初始 schema。
-- 數值一律以十進位字串（TEXT）儲存，避免浮點誤差，也保留官方公布的寫法（例如 0.530）。

CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  organization TEXT NOT NULL,
  dataset_code TEXT,
  dataset_name TEXT NOT NULL,
  official_url TEXT NOT NULL,
  api_url TEXT,
  license TEXT,
  license_note TEXT,
  update_frequency TEXT,
  ingestion TEXT NOT NULL CHECK (ingestion IN ('api_sync', 'reviewed_import')),
  status TEXT NOT NULL CHECK (status IN ('active', 'pending_key', 'pending_verification')),
  notes TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  -- 最近一次檢查的結果：ok、stale（同步失敗，沿用上次成功的資料）、review_needed（官方資料與已審核資料不一致）。
  health TEXT NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'stale', 'review_needed')),
  health_note TEXT
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_date TEXT,
  document_ref TEXT,
  sha256 TEXT,
  format TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'reviewed' CHECK (review_status IN ('reviewed', 'pending')),
  reviewed_at TEXT,
  notes TEXT
);

-- 每筆係數的「目前版本」。歷史版本在 factor_versions，兩邊由同一個寫入函式維護。
CREATE TABLE emission_factors (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  document_id TEXT REFERENCES source_documents(id),
  source_record_id TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL,
  category TEXT NOT NULL,
  factor_type TEXT NOT NULL,
  variant TEXT,
  gas_basis TEXT NOT NULL CHECK (gas_basis IN ('CO2e', 'CO2')),
  value TEXT,
  components TEXT,
  numerator_unit TEXT NOT NULL,
  denominator_unit TEXT,
  original_unit TEXT NOT NULL,
  reference_year INTEGER,
  announcement_year INTEGER,
  announcement_date TEXT,
  effective_from TEXT,
  effective_to TEXT,
  scope TEXT,
  lifecycle_boundary TEXT,
  boundary_basis TEXT CHECK (boundary_basis IN ('stated', 'inferred')),
  methodology TEXT,
  gwp_version TEXT,
  calculability TEXT NOT NULL CHECK (calculability IN ('direct', 'needs_heating_value', 'lookup_only', 'pending')),
  usage_notes TEXT NOT NULL DEFAULT '[]',
  source_url TEXT NOT NULL,
  original TEXT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'withdrawn')),
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  CHECK (value IS NOT NULL OR components IS NOT NULL)
);

CREATE INDEX idx_factors_category_year ON emission_factors (category, reference_year);
CREATE INDEX idx_factors_source ON emission_factors (source_id);

-- 只增不改。每次係數內容改變就多一列；payload 是當時完整的係數（JSON），
-- 讓過去的計算可以用 factor_id + version 重現。
CREATE TABLE factor_versions (
  factor_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  PRIMARY KEY (factor_id, version)
) WITHOUT ROWID;

CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reviewed_import', 'api_sync', 'cross_check')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped', 'review_needed')),
  records_ok INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  records_changed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  source_version TEXT
);

CREATE INDEX idx_sync_jobs_source ON sync_jobs (source_id, id DESC);

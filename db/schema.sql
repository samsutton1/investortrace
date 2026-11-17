-- InvestorTrace database schema (proof of concept)
-- Engine: SQLite 3.35+ (one file, e.g. db/investortrace.db). Ports cleanly to Postgres:
--   INTEGER PRIMARY KEY -> BIGSERIAL, TEXT JSON -> JSONB, TEXT timestamps -> TIMESTAMPTZ.
-- Provider-agnostic: nothing here is specific to DeepSkipTrace. Each provider's raw answer is
-- kept as-is in raw_responses, and a per-provider adapter fills the normalized tables.
-- Timestamps are UTC ISO-8601 text. Money is integer cents. Dates from providers are 'YYYY-MM' or 'YYYY-MM-DD'.

PRAGMA foreign_keys = ON;

-- Skip-trace data vendors (DeepSkipTrace now, a permissible provider later).
CREATE TABLE providers (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,            -- e.g. 'deepskiptrace'
  name          TEXT NOT NULL,
  api_base_url  TEXT,
  status        TEXT NOT NULL DEFAULT 'testing'
                CHECK (status IN ('testing','active','retired')),
  cost_per_hit_cents  INTEGER,                   -- what one billable unit costs us, if known
  notes         TEXT,                            -- terms, permissible-use notes, limits
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Every lookup we send to a provider, with its input.
CREATE TABLE searches (
  id            INTEGER PRIMARY KEY,
  provider_id   INTEGER NOT NULL REFERENCES providers(id),
  search_type   TEXT NOT NULL CHECK (search_type IN ('name','address','phone','email')),
  first_name    TEXT,
  last_name     TEXT,
  street        TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  phone         TEXT,                            -- 10 digits
  email         TEXT,
  input_key     TEXT NOT NULL,                   -- normalized input (lowercased, trimmed) so the same
                                                 -- question to different providers lines up side by side
  request_json  TEXT,                            -- exact body sent
  purpose       TEXT,                            -- business purpose recorded with the search
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','match','no_match','error')),
  error_message TEXT,
  provider_search_id TEXT,                       -- the provider's own id for this search
  skips_used    INTEGER NOT NULL DEFAULT 0,      -- provider units charged for the search itself
  reused        INTEGER NOT NULL DEFAULT 0 CHECK (reused IN (0,1)),  -- provider reopened a saved result for free
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  is_test       INTEGER NOT NULL DEFAULT 1 CHECK (is_test IN (0,1)),  -- 1 = test/demo data
  requested_by  TEXT,
  source        TEXT NOT NULL DEFAULT 'single'
                CHECK (source IN ('single','bulk','api')),
  batch_id      INTEGER REFERENCES batches(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT,
  CHECK (
    (search_type='name'    AND last_name IS NOT NULL AND (zip IS NOT NULL OR (city IS NOT NULL AND state IS NOT NULL))) OR
    (search_type='address' AND street IS NOT NULL AND (zip IS NOT NULL OR (city IS NOT NULL AND state IS NOT NULL))) OR
    (search_type='phone'   AND phone IS NOT NULL) OR
    (search_type='email'   AND email IS NOT NULL)
  )
);
CREATE INDEX idx_searches_input ON searches(input_key, provider_id);
CREATE INDEX idx_searches_created ON searches(created_at);

-- Bulk CSV uploads (one row per upload; each record becomes a search).
CREATE TABLE batches (
  id            INTEGER PRIMARY KEY,
  file_name     TEXT,
  record_count  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT
);

-- The provider's answer exactly as received (one search can have several calls,
-- e.g. an address search plus one unlock call per person).
CREATE TABLE raw_responses (
  id            INTEGER PRIMARY KEY,
  search_id     INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,                   -- e.g. 'POST /search', 'POST /people/{id}'
  http_status   INTEGER,
  body          TEXT NOT NULL,                   -- raw JSON text, untouched
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Normalized people returned by a search.
CREATE TABLE persons (
  id            INTEGER PRIMARY KEY,
  search_id     INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  raw_response_id INTEGER REFERENCES raw_responses(id),
  provider_person_id TEXT,                       -- provider's id (used to unlock/reopen)
  rank          INTEGER,                         -- provider's order, 1 = best match
  full_name     TEXT,
  first_name    TEXT,
  middle_name   TEXT,
  last_name     TEXT,
  aliases       TEXT,                            -- JSON array of other names
  age           INTEGER,
  deceased      INTEGER CHECK (deceased IN (0,1)),
  likely_deceased INTEGER CHECK (likely_deceased IN (0,1)),
  date_of_death TEXT,
  is_owner      INTEGER CHECK (is_owner IN (0,1)),   -- owns the searched address (address searches)
  last_seen_at_address TEXT,
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  unlocked_at   TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
                CHECK (review_status IN ('unreviewed','verified','discarded')),
  review_note   TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (search_id, provider_person_id)
);
CREATE INDEX idx_persons_name ON persons(last_name, first_name);

CREATE TABLE person_phones (
  id            INTEGER PRIMARY KEY,
  person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  rank          INTEGER,
  number        TEXT NOT NULL,                   -- 10 digits
  display       TEXT,
  phone_type    TEXT CHECK (phone_type IN ('mobile','landline','voip','unknown')),
  carrier       TEXT,
  disconnected  INTEGER CHECK (disconnected IN (0,1)),
  business      INTEGER CHECK (business IN (0,1)),
  flagged       INTEGER CHECK (flagged IN (0,1)),   -- provider says it may not be real
  first_seen    TEXT,
  last_seen     TEXT,
  dnc_status    TEXT NOT NULL DEFAULT 'unchecked'   -- filled by a separate DNC/litigator scrub
                CHECK (dnc_status IN ('unchecked','clear','dnc','litigator')),
  dnc_checked_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
                CHECK (review_status IN ('unreviewed','verified','discarded')),
  review_note   TEXT
);
CREATE INDEX idx_phones_number ON person_phones(number);

CREATE TABLE person_emails (
  id            INTEGER PRIMARY KEY,
  person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  rank          INTEGER,
  email         TEXT NOT NULL,
  inactive      INTEGER CHECK (inactive IN (0,1)),
  first_seen    TEXT,
  last_seen     TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
                CHECK (review_status IN ('unreviewed','verified','discarded'))
);
CREATE INDEX idx_emails_email ON person_emails(email);

CREATE TABLE person_addresses (
  id            INTEGER PRIMARY KEY,
  person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  rank          INTEGER,
  street        TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  county        TEXT,
  first_seen    TEXT,
  last_seen     TEXT,
  owned_now     INTEGER CHECK (owned_now IN (0,1)),
  owned_before  INTEGER CHECK (owned_before IN (0,1))
);

CREATE TABLE person_relatives (
  id            INTEGER PRIMARY KEY,
  person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  rank          INTEGER,
  relationship  TEXT,                            -- Spouse, Child, Parent, Sibling, ...
  relation_group TEXT CHECK (relation_group IN ('family','associate')),
  full_name     TEXT,
  first_name    TEXT,
  last_name     TEXT,
  age           INTEGER,
  deceased      INTEGER CHECK (deceased IN (0,1)),
  likely_deceased INTEGER CHECK (likely_deceased IN (0,1)),
  address       TEXT,
  phones        TEXT,                            -- JSON array
  emails        TEXT                             -- JSON array
);

-- Properties tied to a person.
CREATE TABLE properties (
  id            INTEGER PRIMARY KEY,
  person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  street        TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  county        TEXT,
  parcel_number TEXT,                            -- APN
  mailing_address TEXT,
  owners        TEXT,                            -- JSON array of owner names
  owned_now     INTEGER CHECK (owned_now IN (0,1)),
  estimated_value_cents INTEGER,
  assessed_value_cents  INTEGER,
  assessed_year INTEGER,
  living_sqft   INTEGER,
  lot_sqft      INTEGER,
  bedrooms      REAL,
  bathrooms     REAL,
  year_built    INTEGER,
  in_foreclosure INTEGER CHECK (in_foreclosure IN (0,1)),
  extra         TEXT                             -- JSON for provider fields with no column yet
);
CREATE INDEX idx_properties_apn ON properties(parcel_number);

-- Sales, loans, and foreclosure filings on a property.
CREATE TABLE property_events (
  id            INTEGER PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('sale','loan','foreclosure','other')),
  event_date    TEXT,
  amount_cents  INTEGER,
  party         TEXT,                            -- buyer, lender, or trustee
  document_type TEXT,                            -- e.g. deed, deed of trust, notice of trustee sale
  details       TEXT                             -- JSON
);

-- Every billable unit, so spend can be totaled by provider, day, or search.
CREATE TABLE skip_ledger (
  id            INTEGER PRIMARY KEY,
  provider_id   INTEGER NOT NULL REFERENCES providers(id),
  search_id     INTEGER REFERENCES searches(id) ON DELETE SET NULL,
  person_id     INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('search_hit','unlock','refill','adjustment')),
  skips         INTEGER NOT NULL,                -- positive = used, negative = credited
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ledger_provider_date ON skip_ledger(provider_id, created_at);

-- Search history with spend, newest first.
CREATE VIEW v_search_history AS
SELECT s.id, s.created_at, p.name AS provider, s.search_type, s.input_key, s.status,
       (SELECT COUNT(*) FROM persons x WHERE x.search_id = s.id) AS people_found,
       COALESCE((SELECT SUM(l.skips) FROM skip_ledger l WHERE l.search_id = s.id), 0) AS skips_used,
       COALESCE((SELECT SUM(l.cost_cents) FROM skip_ledger l WHERE l.search_id = s.id), 0) AS cost_cents,
       s.is_test
FROM searches s JOIN providers p ON p.id = s.provider_id
ORDER BY s.created_at DESC;

-- Side-by-side: the same input across providers, one row per phone found.
CREATE VIEW v_provider_comparison AS
SELECT s.input_key, pr.name AS provider, s.created_at, pe.rank AS person_rank, pe.full_name,
       pe.is_owner, ph.number, ph.phone_type, ph.carrier, ph.disconnected, ph.flagged,
       ph.review_status AS phone_review, pe.review_status AS person_review
FROM searches s
JOIN providers pr ON pr.id = s.provider_id
JOIN persons pe ON pe.search_id = s.id
LEFT JOIN person_phones ph ON ph.person_id = pe.id;

-- Hit rate and spend per provider.
CREATE VIEW v_provider_stats AS
SELECT pr.name AS provider,
       COUNT(s.id) AS searches,
       SUM(s.status = 'match') AS matches,
       ROUND(100.0 * SUM(s.status = 'match') / NULLIF(SUM(s.status IN ('match','no_match')),0), 1) AS hit_rate_pct,
       (SELECT COALESCE(SUM(skips),0) FROM skip_ledger l WHERE l.provider_id = pr.id) AS skips_used,
       (SELECT COALESCE(SUM(cost_cents),0) FROM skip_ledger l WHERE l.provider_id = pr.id) AS cost_cents
FROM providers pr LEFT JOIN searches s ON s.provider_id = pr.id
GROUP BY pr.id;

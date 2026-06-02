-- AGEWEC 2026 — D1 initial schema (0001)
-- Apply with: wrangler d1 migrations apply agewec
-- Design notes:
--  * Additive changes only after launch. Add columns, do not drop/rename.
--  * Every submission stores the document versions it agreed to (form/rules/privacy),
--    and every score stores the rubric_version it was given under, so later changes
--    stay traceable and old rows are never silently re-interpreted.

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,            -- e.g. "sub_xxxxxxxx"
  created_at      TEXT NOT NULL,               -- ISO 8601

  -- basic info
  title           TEXT NOT NULL,
  author          TEXT NOT NULL,               -- individual only (no teams)
  email           TEXT NOT NULL,
  affiliation     TEXT,
  country         TEXT,

  -- video
  video_url       TEXT NOT NULL,

  -- AI usage & workflow (core)
  ai_tools        TEXT NOT NULL,
  assets          TEXT,
  workflow        TEXT NOT NULL,
  screenshot_url  TEXT,
  license_category TEXT,                        -- commercial_ok | non_commercial | unknown

  -- description & optional
  description     TEXT NOT NULL,
  repo_url        TEXT,
  sns             TEXT,
  local_env       TEXT,
  attend          TEXT,                          -- onsite | online | '' (optional)

  -- consent flags (0/1)
  c_rules         INTEGER DEFAULT 0,
  c_rights        INTEGER DEFAULT 0,
  c_url           INTEGER DEFAULT 0,
  c_license       INTEGER DEFAULT 0,
  c_thirdparty    INTEGER DEFAULT 0,
  c_privacy       INTEGER DEFAULT 0,
  c_pr            INTEGER DEFAULT 0,            -- optional: tourism PR use
  c_guardian      INTEGER DEFAULT 0,            -- optional: minor guardian consent

  -- version stamps (traceability across later changes)
  form_version    TEXT,
  rules_version   TEXT,
  privacy_version TEXT,

  -- review lifecycle (admin-controlled)
  status          TEXT DEFAULT 'received',     -- received | screening | judging | finalist | done
  is_public       INTEGER DEFAULT 0,           -- gates appearance on /entries
  finalist        INTEGER DEFAULT 0,
  award           TEXT DEFAULT '',             -- e.g. "Grand Prize", "YE Digital賞"
  incomplete      INTEGER DEFAULT 0,           -- 不備フラグ
  disqualified    INTEGER DEFAULT 0            -- 失格フラグ
);

-- One row per (submission, judge). Upserted from /judge.
CREATE TABLE IF NOT EXISTS scores (
  submission_id   TEXT NOT NULL,
  judge_email     TEXT NOT NULL,
  c1              INTEGER,   -- Tourism Appeal      (0-3)
  c2              INTEGER,   -- Emotional Impact
  c3              INTEGER,   -- Narrative Coherence
  c4              INTEGER,   -- AI Autonomy
  c5              INTEGER,   -- Workflow Design & Reproducibility
  c6              INTEGER,   -- Technical Creativity & Originality
  comment         TEXT,
  rubric_version  TEXT,
  updated_at      TEXT,
  PRIMARY KEY (submission_id, judge_email),
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

-- Judges and admins. Role gates API access; email comes from Cloudflare Access.
CREATE TABLE IF NOT EXISTS judges (
  email           TEXT PRIMARY KEY,
  name            TEXT,
  role            TEXT DEFAULT 'judge',        -- judge | admin
  active          INTEGER DEFAULT 1
);

-- Optional sharding: if a judge has any rows here, they only see those
-- submissions; otherwise they see all submissions in 'judging' status.
CREATE TABLE IF NOT EXISTS assignments (
  submission_id   TEXT NOT NULL,
  judge_email     TEXT NOT NULL,
  PRIMARY KEY (submission_id, judge_email)
);

-- Simple key/value settings (deadline lock, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('submissions_open', '1');

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public);
CREATE INDEX IF NOT EXISTS idx_scores_submission ON scores(submission_id);

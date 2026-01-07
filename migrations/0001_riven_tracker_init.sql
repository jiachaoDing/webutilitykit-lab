-- 5.1 sync_state
CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
);

-- 5.2 riven_weapon_dict
CREATE TABLE IF NOT EXISTS riven_weapon_dict (
    slug TEXT PRIMARY KEY,
    name_en TEXT,
    icon TEXT,
    thumb TEXT,
    weapon_group TEXT,
    riven_type TEXT,
    disposition REAL,
    req_mr INTEGER,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_weapon_name_en ON riven_weapon_dict(name_en);

-- 5.3 tracked_weapon
CREATE TABLE IF NOT EXISTS tracked_weapon (
    slug TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_tracked ON tracked_weapon(enabled, priority DESC);

-- 5.4 riven_bottom_tick
CREATE TABLE IF NOT EXISTS riven_bottom_tick (
    ts TEXT,
    platform TEXT,
    weapon_slug TEXT,
    bottom_price INTEGER,
    sample_count INTEGER,
    min_price INTEGER,
    p5_price INTEGER,
    created_at TEXT,
    source_status TEXT,
    error_code TEXT,
    PRIMARY KEY (ts, platform, weapon_slug)
);
CREATE INDEX IF NOT EXISTS idx_tick ON riven_bottom_tick(platform, weapon_slug, ts);

-- 5.5 job_run
CREATE TABLE IF NOT EXISTS job_run (
    id TEXT PRIMARY KEY,
    job_name TEXT,
    scheduled_ts TEXT,
    started_at TEXT,
    finished_at TEXT,
    status TEXT,
    detail TEXT
);


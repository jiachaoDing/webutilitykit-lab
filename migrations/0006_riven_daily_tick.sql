-- 增加天级聚合表记录
CREATE TABLE IF NOT EXISTS riven_daily_tick (
    ts TEXT,                -- 对齐到天的时间戳 (YYYY-MM-DD)
    platform TEXT,          -- 平台 (pc)
    weapon_slug TEXT,       -- 武器 ID
    avg_bottom_price INTEGER,
    avg_active_count INTEGER,
    min_price INTEGER,
    avg_p5_price INTEGER,
    avg_p10_price INTEGER,
    sample_count INTEGER,    -- 当天总采样数
    created_at TEXT,
    PRIMARY KEY (ts, platform, weapon_slug)
);
CREATE INDEX IF NOT EXISTS idx_daily_tick ON riven_daily_tick(platform, weapon_slug, ts);


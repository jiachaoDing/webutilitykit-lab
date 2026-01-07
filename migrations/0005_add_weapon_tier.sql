-- 为 tracked_weapon 表添加 tier 字段，用于区分热门/冷门武器
-- 'hot': 常用武器（加权均价排名前50）- 每两分钟爬5把
-- 'cold': 不常用武器（其余）- 每两分钟爬1把
-- 每天 UTC 03:00 根据最近7天的 bottom_price 均值自动更新分层
ALTER TABLE tracked_weapon ADD COLUMN tier TEXT DEFAULT 'cold';

-- 创建索引以优化按 tier 查询
CREATE INDEX IF NOT EXISTS idx_tracked_tier ON tracked_weapon(tier, enabled, priority DESC);


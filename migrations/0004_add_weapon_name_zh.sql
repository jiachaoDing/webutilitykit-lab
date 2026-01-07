-- 为武器字典表增加 name_zh 字段，存储中文名称
ALTER TABLE riven_weapon_dict ADD COLUMN name_zh TEXT;
-- 为中文名增加索引，提高搜索性能
CREATE INDEX IF NOT EXISTS idx_weapon_name_zh ON riven_weapon_dict(name_zh);


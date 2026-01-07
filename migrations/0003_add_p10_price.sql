-- 为价格表增加 p10_price 字段，记录第 10 低价
ALTER TABLE riven_bottom_tick ADD COLUMN p10_price INTEGER;


-- 为价格表增加 active_count 字段，记录总的在线订单数
ALTER TABLE riven_bottom_tick ADD COLUMN active_count INTEGER DEFAULT 0;


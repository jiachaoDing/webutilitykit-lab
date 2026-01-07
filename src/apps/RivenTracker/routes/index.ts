import { Hono } from "hono";
import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { TrendService } from "../services/TrendService";

const rivenTrackerApp = new Hono<{ Bindings: { DB: D1Database } }>();

/**
 * 武器搜索接口
 * 缓存策略：1 小时（武器字典每天更新一次）
 */
rivenTrackerApp.get("/weapons", async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");
  const trendService = new TrendService(new TickRepo(c.env.DB), new WeaponRepo(c.env.DB));
  
  // 武器字典缓存 1 小时
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  c.header('CDN-Cache-Control', 'max-age=3600');
  
  return c.json(await trendService.searchWeapons(q, limit));
});

/**
 * 获取底价趋势接口
 * 缓存策略：热门武器 5 分钟，冷门武器 2 小时
 */
rivenTrackerApp.get("/bottom-trend", async (c) => {
  const weapon = c.req.query("weapon");
  const range = c.req.query("range") || "30d";
  const platform = c.req.query("platform") || "pc";
  if (!weapon) return c.json({ error: "weapon is required" }, 400);

  const { TrackedRepo } = await import("../repos/TrackedRepo");
  const trendService = new TrendService(
    new TickRepo(c.env.DB), 
    new WeaponRepo(c.env.DB),
    new TrackedRepo(c.env.DB)
  );
  
  // 获取武器的缓存时间（基于 tier）
  const cacheTTL = await trendService.getCacheTTL(weapon);
  
  // 设置缓存头
  c.header('Cache-Control', `public, max-age=${cacheTTL}, s-maxage=${cacheTTL}`);
  c.header('CDN-Cache-Control', `max-age=${cacheTTL}`);
  
  return c.json(await trendService.getTrend(weapon, range, platform));
});

/**
 * 当前底价快照接口
 * 缓存策略：与趋势接口相同（热门 5 分钟，冷门 2 小时）
 */
rivenTrackerApp.get("/bottom-now", async (c) => {
  const weapon = c.req.query("weapon");
  const platform = c.req.query("platform") || "pc";
  if (!weapon) return c.json({ error: "weapon is required" }, 400);

  const { TrackedRepo } = await import("../repos/TrackedRepo");
  const trendService = new TrendService(
    new TickRepo(c.env.DB), 
    new WeaponRepo(c.env.DB),
    new TrackedRepo(c.env.DB)
  );
  
  // 获取武器的缓存时间（基于 tier）
  const cacheTTL = await trendService.getCacheTTL(weapon);
  
  // 设置缓存头
  c.header('Cache-Control', `public, max-age=${cacheTTL}, s-maxage=${cacheTTL}`);
  c.header('CDN-Cache-Control', `max-age=${cacheTTL}`);
  
  return c.json(await trendService.getLatest(weapon, platform));
});

/**
 * 获取热门/高价武器
 * 缓存策略：3 分钟（榜单变化较快）
 */
rivenTrackerApp.get("/hot-weapons", async (c) => {
  const limit = parseInt(c.req.query("limit") || "10");
  const sortBy = (c.req.query("sortBy") as 'active_count' | 'price') || "price";
  const trendService = new TrendService(new TickRepo(c.env.DB), new WeaponRepo(c.env.DB));
  
  // 热门榜单缓存 3 分钟
  c.header('Cache-Control', 'public, max-age=180, s-maxage=180');
  c.header('CDN-Cache-Control', 'max-age=180');
  
  return c.json(await trendService.getHotWeapons(limit, sortBy));
});

/**
 * 健康检查与状态接口
 * 缓存策略：1 分钟（状态信息变化不频繁）
 */
rivenTrackerApp.get("/health", async (c) => {
  const { TickRepo } = await import("../repos/TickRepo");
  const { TrackedRepo } = await import("../repos/TrackedRepo");
  
  const tickRepo = new TickRepo(c.env.DB);
  const trackedRepo = new TrackedRepo(c.env.DB);
  
  const lastTick = await tickRepo.getLastTickTime();
  const trackedCount = await trackedRepo.countEnabled();
  
  // 健康状态缓存 1 分钟
  c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
  c.header('CDN-Cache-Control', 'max-age=60');
  
  return c.json({
    ok: true,
    last_tick_utc: lastTick,
    tracked_weapon_count: trackedCount,
    notes: "tiered sampling: hot ~20min, cold ~12h"
  });
});

/**
 * 调试接口：手动触发同步 (仅建议开发环境下使用)
 */
rivenTrackerApp.post("/debug/sync", async (c) => {
  const { SyncService } = await import("../services/SyncService");
  const { WfmV2Client } = await import("../clients/WfmV2Client");
  const { SyncStateRepo } = await import("../repos/SyncStateRepo");
  const syncService = new SyncService(new WfmV2Client(), new SyncStateRepo(c.env.DB), new WeaponRepo(c.env.DB));
  const result = await syncService.syncRivens();
  return c.json(result);
});

/**
 * 调试接口：手动触发采样 (仅建议开发环境下使用)
 */
rivenTrackerApp.post("/debug/sample", async (c) => {
  const { SamplingService } = await import("../services/SamplingService");
  const { WfmV1Client } = await import("../clients/WfmV1Client");
  const { Sharding } = await import("../domain/Sharding");
  const { SamplingCursorRepo } = await import("../repos/SamplingCursorRepo");
  const shard = parseInt(c.req.query("shard") || "0");
  const batchSize = parseInt(c.req.query("batchSize") || "15");
  const windowTs = Sharding.getWindowTs(new Date());
  const samplingService = new SamplingService(
    new WfmV1Client(),
    new TickRepo(c.env.DB),
    new (await import("../repos/TrackedRepo")).TrackedRepo(c.env.DB),
  );

  // 兼容旧参数：shard 视为"起始批次编号"，转换成 cursor 偏移
  // 例如 shard=0 -> 从 0 开始；shard=1 -> 从 batchSize 开始。
  const cursor = Math.max(0, shard) * Math.max(1, batchSize);
  const stats = await samplingService.runBatch(cursor, batchSize, windowTs, { timeBudgetMs: 25000 });

  // 同步写入 cursor，方便后续 cron 接着跑（可选）
  const cursorRepo = new SamplingCursorRepo(c.env.DB);
  await cursorRepo.set(stats.cursor_after);
  return c.json(stats);
});

/**
 * 调试接口：手动触发武器分层更新
 * 根据最近 N 天的价格数据，更新武器的 hot/cold 分层
 */
rivenTrackerApp.post("/debug/update-tiers", async (c) => {
  const { TierUpdateService } = await import("../services/TierUpdateService");
  const { TrackedRepo } = await import("../repos/TrackedRepo");
  
  const days = parseInt(c.req.query("days") || "7");
  const hotThreshold = parseInt(c.req.query("hotThreshold") || "50");
  
  const tierUpdateService = new TierUpdateService(c.env.DB, new TrackedRepo(c.env.DB));
  const result = await tierUpdateService.updateTiers(days, hotThreshold);
  
  return c.json({
    success: true,
    result
  });
});

/**
 * 调试接口：查看当前武器分层统计
 */
rivenTrackerApp.get("/debug/tier-stats", async (c) => {
  const { TrackedRepo } = await import("../repos/TrackedRepo");
  const trackedRepo = new TrackedRepo(c.env.DB);
  
  const stats = await trackedRepo.getTierStats();
  const hotWeapons = await trackedRepo.getEnabledByTier('hot');
  const coldWeapons = await trackedRepo.getEnabledByTier('cold');
  
  return c.json({
    stats,
    hot_weapons: hotWeapons.map(w => w.slug).slice(0, 20),
    cold_weapons: coldWeapons.map(w => w.slug).slice(0, 20),
    hot_count: hotWeapons.length,
    cold_count: coldWeapons.length
  });
});

export default rivenTrackerApp;


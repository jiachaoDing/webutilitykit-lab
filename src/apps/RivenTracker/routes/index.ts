import { Hono } from "hono";
import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { TrendService } from "../services/TrendService";

const rivenTrackerApp = new Hono<{ 
  Bindings: { 
    DB: D1Database; 
    KV: KVNamespace; 
    RIVEN_COORDINATOR: DurableObjectNamespace 
  } 
}>();

/**
 * 武器搜索接口
 * 缓存策略：1 小时（武器字典每天更新一次）
 */
rivenTrackerApp.get("/weapons", async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");
  const trendService = new TrendService(
    new TickRepo(c.env.DB), 
    new WeaponRepo(c.env.DB),
    undefined,
    c.env.KV,
    c.env.RIVEN_COORDINATOR,
    c.executionCtx
  );
  
  // 武器字典缓存 1 小时
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  c.header('CDN-Cache-Control', 'max-age=3600');
  
  return c.json(await trendService.searchWeapons(q, limit));
});

/**
 * 获取底价趋势接口
 * 浏览器/CDN 缓存：5 分钟
 */
rivenTrackerApp.get("/bottom-trend", async (c) => {
  const weapon = c.req.query("weapon");
  const range = c.req.query("range") || "30d";
  const platform = c.req.query("platform") || "pc";
  const mode = c.req.query("mode") || "raw";
  if (!weapon) return c.json({ error: "weapon is required" }, 400);

  const trendService = new TrendService(
    new TickRepo(c.env.DB),
    new WeaponRepo(c.env.DB),
    undefined,
    c.env.KV,
    c.env.RIVEN_COORDINATOR
  );

  // 统一设置 5 分钟的浏览器/CDN 缓存
  const cacheTTL = 300;
  c.header('Cache-Control', `public, max-age=${cacheTTL}, s-maxage=${cacheTTL}`);
  c.header('CDN-Cache-Control', `max-age=${cacheTTL}`);

  return c.json(await trendService.getTrend(weapon, range, platform, mode));
});

/**
 * 当前底价快照接口
 * 浏览器缓存：1 分钟
 */
rivenTrackerApp.get("/bottom-now", async (c) => {
  const weapon = c.req.query("weapon");
  const platform = c.req.query("platform") || "pc";
  if (!weapon) return c.json({ error: "weapon is required" }, 400);

  const trendService = new TrendService(
    new TickRepo(c.env.DB), 
    new WeaponRepo(c.env.DB),
    undefined,
    c.env.KV,
    c.env.RIVEN_COORDINATOR,
    c.executionCtx
  );
  
  // 快照对实时性要求较高，缓存 1 分钟
  const cacheTTL = 60;
  c.header('Cache-Control', `public, max-age=${cacheTTL}, s-maxage=${cacheTTL}`);
  
  return c.json(await trendService.getLatest(weapon, platform));
});

/**
 * 获取最新热门/高价武器
 * 缓存策略：3 分钟（榜单变化较快）
 */
rivenTrackerApp.get("/hot-weapons", async (c) => {
  const limit = parseInt(c.req.query("limit") || "10");
  const sortBy = (c.req.query("sortBy") as 'active_count' | 'price') || "price";
  const trendService = new TrendService(
    new TickRepo(c.env.DB), 
    new WeaponRepo(c.env.DB),
    undefined,
    c.env.KV,
    c.env.RIVEN_COORDINATOR,
    c.executionCtx
  );
  
  // 热门榜单缓存 3 分钟
  c.header('Cache-Control', 'public, max-age=180, s-maxage=180');
  c.header('CDN-Cache-Control', 'max-age=180');
  
  return c.json(await trendService.getNewHotWeapons(limit, sortBy));
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
    notes: "DO-Coordinated sampling: 5/min, hot ~20min, cold ~2.4h. Cache: DO Memory + KV Bundle."
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
 * 调试接口：手动触发采样 (新架构：通过 DO 协同)
 */
rivenTrackerApp.post("/debug/sample", async (c) => {
  const { SamplingService } = await import("../services/SamplingService");
  const { WfmV1Client } = await import("../clients/WfmV1Client");
  const { Sharding } = await import("../domain/Sharding");
  const { TrackedRepo } = await import("../repos/TrackedRepo");
  const { TickRepo } = await import("../repos/TickRepo");

  const hotSize = parseInt(c.req.query("hotSize") || "3");
  const coldSize = parseInt(c.req.query("coldSize") || "0");
  const windowTs = Sharding.getWindowTs(new Date());
  
  const doId = c.env.RIVEN_COORDINATOR.idFromName("global");
  const coordinator = c.env.RIVEN_COORDINATOR.get(doId);

  // 1. 从 DO 获取任务
  const nextBatchResp = await coordinator.fetch(
    `http://do/next-batch?hotBatchSize=${hotSize}&coldBatchSize=${coldSize}`
  );
  const { slugs } = (await nextBatchResp.json()) as { slugs: string[] };

  if (slugs.length === 0) return c.json({ message: "No slugs to sample" });

  // 2. 执行采样
  const samplingService = new SamplingService(
    new WfmV1Client(),
    new TickRepo(c.env.DB),
    new TrackedRepo(c.env.DB)
  );

  const { samples, stats } = await samplingService.runBatch(slugs, windowTs, { timeBudgetMs: 25000 });

  // 3. 提交结果到 DO
  const appendResp = await coordinator.fetch("http://do/append-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts: windowTs, samples })
  });
  
  return c.json({ 
    stats, 
    append: await appendResp.json(),
    slugs 
  });
});

/**
 * 调试接口：手动刷新武器名单缓存
 */
rivenTrackerApp.post("/debug/refresh-list", async (c) => {
  const doId = c.env.RIVEN_COORDINATOR.idFromName("global");
  const coordinator = c.env.RIVEN_COORDINATOR.get(doId);
  const resp = await coordinator.fetch("http://do/refresh-lists", { method: "POST" });
  return c.json(await resp.json());
});

/**
 * 调试接口：手动强制同步快照到 KV
 */
rivenTrackerApp.post("/debug/sync-snapshot", async (c) => {
  const doId = c.env.RIVEN_COORDINATOR.idFromName("global");
  const coordinator = c.env.RIVEN_COORDINATOR.get(doId);
  const resp = await coordinator.fetch("http://do/sync-snapshot", { method: "POST" });
  return c.json(await resp.json());
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


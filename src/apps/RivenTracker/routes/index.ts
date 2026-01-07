import { Hono } from "hono";
import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { TrendService } from "../services/TrendService";

const rivenTrackerApp = new Hono<{ Bindings: { DB: D1Database } }>();

/**
 * 武器搜索接口
 */
rivenTrackerApp.get("/weapons", async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");
  const trendService = new TrendService(new TickRepo(c.env.DB), new WeaponRepo(c.env.DB));
  return c.json(await trendService.searchWeapons(q, limit));
});

/**
 * 获取底价趋势接口
 */
rivenTrackerApp.get("/bottom-trend", async (c) => {
  const weapon = c.req.query("weapon");
  const range = c.req.query("range") || "30d";
  const platform = c.req.query("platform") || "pc";
  if (!weapon) return c.json({ error: "weapon is required" }, 400);

  const trendService = new TrendService(new TickRepo(c.env.DB), new WeaponRepo(c.env.DB));
  return c.json(await trendService.getTrend(weapon, range, platform));
});

/**
 * 当前底价快照接口
 */
rivenTrackerApp.get("/bottom-now", async (c) => {
  const weapon = c.req.query("weapon");
  const platform = c.req.query("platform") || "pc";
  if (!weapon) return c.json({ error: "weapon is required" }, 400);

  const trendService = new TrendService(new TickRepo(c.env.DB), new WeaponRepo(c.env.DB));
  return c.json(await trendService.getLatest(weapon, platform));
});

/**
 * 获取热门武器 (按卖家数)
 */
rivenTrackerApp.get("/hot-weapons", async (c) => {
  const limit = parseInt(c.req.query("limit") || "10");
  const trendService = new TrendService(new TickRepo(c.env.DB), new WeaponRepo(c.env.DB));
  return c.json(await trendService.getHotWeapons(limit));
});

/**
 * 健康检查与状态接口
 */
rivenTrackerApp.get("/health", async (c) => {
  const { TickRepo } = await import("../repos/TickRepo");
  const { TrackedRepo } = await import("../repos/TrackedRepo");
  
  const tickRepo = new TickRepo(c.env.DB);
  const trackedRepo = new TrackedRepo(c.env.DB);
  
  const lastTick = await tickRepo.getLastTickTime();
  const trackedCount = await trackedRepo.countEnabled();
  
  return c.json({
    ok: true,
    last_tick_utc: lastTick,
    tracked_weapon_count: trackedCount,
    notes: "ingame-only sampling every 30 minutes"
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
  const shard = parseInt(c.req.query("shard") || "0");
  const windowTs = Sharding.getWindowTs(new Date());
  const samplingService = new SamplingService(new WfmV1Client(), new TickRepo(c.env.DB), new (await import("../repos/TrackedRepo")).TrackedRepo(c.env.DB));
  const stats = await samplingService.runShard(shard, windowTs);
  return c.json(stats);
});

export default rivenTrackerApp;


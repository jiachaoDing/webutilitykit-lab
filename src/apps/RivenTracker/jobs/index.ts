import { SamplingService } from "../services/SamplingService";
import { SyncService } from "../services/SyncService";
import { TierUpdateService } from "../services/TierUpdateService";
import { WfmV1Client } from "../clients/WfmV1Client";
import { WfmV2Client } from "../clients/WfmV2Client";
import { TickRepo } from "../repos/TickRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { SyncStateRepo } from "../repos/SyncStateRepo";
import { SamplingCursorRepo } from "../repos/SamplingCursorRepo";
import { JobRunRepo } from "../repos/JobRunRepo";
import { Sharding } from "../domain/Sharding";

export async function handleScheduled(event: any, env: any, ctx: any) {
  const db = env.DB;
  const now = new Date();
  
  // 1. 字典同步任务 (例如每天 UTC 03:00)
  if (event.cron === "0 3 * * *") {
    const syncService = new SyncService(new WfmV2Client(), new SyncStateRepo(db), new WeaponRepo(db));
    const tierUpdateService = new TierUpdateService(db, new TrackedRepo(db));
    const jobRepo = new JobRunRepo(db);
    const jobId = crypto.randomUUID();
    
    await jobRepo.create({
      id: jobId,
      job_name: 'sync_rivens',
      scheduled_ts: now.toISOString(),
      started_at: now.toISOString(),
      status: 'partial',
      detail: 'Starting sync'
    });

    try {
      const result = await syncService.syncRivens();
      await jobRepo.update(jobId, 'success', new Date().toISOString(), JSON.stringify(result));
      
      // 字典同步成功后，更新武器分层（基于最近 7 天的价格统计）
      console.log('[TierUpdate] Starting weapon tier update...');
      const tierJobId = crypto.randomUUID();
      await jobRepo.create({
        id: tierJobId,
        job_name: 'update_weapon_tiers',
        scheduled_ts: now.toISOString(),
        started_at: new Date().toISOString(),
        status: 'partial',
        detail: 'Updating weapon tiers based on 7-day price stats'
      });
      
      try {
        const tierResult = await tierUpdateService.updateTiers(7, 50);
        await jobRepo.update(tierJobId, 'success', new Date().toISOString(), JSON.stringify(tierResult));
        console.log(`[TierUpdate] Success: ${tierResult.hot_count} hot, ${tierResult.cold_count} cold`);
      } catch (tierError: any) {
        console.error(`[TierUpdate] Failed: ${tierError?.message || String(tierError)}`);
        await jobRepo.update(tierJobId, 'fail', new Date().toISOString(), JSON.stringify({ error: tierError?.message || String(tierError) }));
      }
    } catch (e: any) {
      await jobRepo.update(jobId, 'fail', new Date().toISOString(), JSON.stringify({ error: e.message }));
    } finally {
      // 额外维护任务：保留 job_run 最近 7 天
      try {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const deleted = await jobRepo.purgeOlderThan(cutoff);
        console.log(`[JobRun] purged older than 7d (${cutoff}), deleted=${deleted}`);
      } catch (e: any) {
        console.error(`[JobRun] purge failed: ${e?.message || String(e)}`);
      }
    }
    return;
  }

  // 2. 价格采样游标任务（每分钟触发一次；分层采样：奇偶分钟交替）
  const windowTs = Sharding.getWindowTs(now);

  const samplingService = new SamplingService(new WfmV1Client(), new TickRepo(db), new TrackedRepo(db));
  const cursorRepo = new SamplingCursorRepo(db);
  const jobRepo = new JobRunRepo(db);
  const jobId = crypto.randomUUID();

  // 获取分层游标（如果不存在则初始化为 0）
  const prev = await cursorRepo.getTiered();
  const cursorHot = prev?.cursorHot ?? 0;
  const cursorCold = prev?.cursorCold ?? 0;

  // 分层采样配置（奇偶分钟交替）：
  // - 奇数分钟：爬 3 把热门武器
  // - 偶数分钟：爬 2 把热门 + 1 把冷门武器
  // - 每分钟总计爬 3 把武器（与原配置一致）
  const currentMinute = now.getMinutes();
  const isEvenMinute = currentMinute % 2 === 0;
  
  const hotBatchSize = isEvenMinute 
    ? Math.max(1, parseInt(env.HOT_BATCH_SIZE_EVEN || "2"))
    : Math.max(1, parseInt(env.HOT_BATCH_SIZE_ODD || "3"));
  
  const coldBatchSize = isEvenMinute 
    ? Math.max(0, parseInt(env.COLD_BATCH_SIZE || "1"))
    : 0;

  await jobRepo.create({
    id: jobId,
    job_name: `sample_tiered`,
    scheduled_ts: windowTs,
    started_at: now.toISOString(),
    status: 'partial',
    detail: JSON.stringify({ 
      windowTs,
      minute: currentMinute,
      cycle: isEvenMinute ? 'even' : 'odd',
      cursorHot, 
      cursorCold, 
      hotBatchSize, 
      coldBatchSize 
    })
  });

  try {
    const stats = await samplingService.runTieredBatch(
      cursorHot, 
      cursorCold, 
      hotBatchSize, 
      coldBatchSize, 
      windowTs, 
      { timeBudgetMs: 20000 }
    );
    
    await cursorRepo.setTiered(stats.cursor_hot_after, stats.cursor_cold_after);
    
    // 精简摘要，避免 detail 字段过大
    const summary = {
      windowTs,
      tier_stats: {
        hot: { total: stats.total_hot, processed: stats.processed_hot },
        cold: { total: stats.total_cold, processed: stats.processed_cold }
      },
      cursor_hot: { before: stats.cursor_hot_before, after: stats.cursor_hot_after },
      cursor_cold: { before: stats.cursor_cold_before, after: stats.cursor_cold_after },
      ok: stats.ok,
      no_data: stats.no_data,
      error: stats.error,
      stopped_by_deadline: stats.stopped_by_deadline,
      errors_sample: Array.isArray(stats.errors) ? stats.errors.slice(0, 5) : [],
    };
    
    try {
      await jobRepo.update(jobId, 'success', new Date().toISOString(), JSON.stringify(summary));
    } catch (e: any) {
      console.error(`[JobRun] update(success) failed: ${e?.message || String(e)}`);
    }
  } catch (e: any) {
    try {
      await jobRepo.update(jobId, 'fail', new Date().toISOString(), JSON.stringify({ error: e?.message || String(e) }));
    } catch (e2: any) {
      console.error(`[JobRun] update(fail) failed: ${e2?.message || String(e2)}`);
    }
  }
}


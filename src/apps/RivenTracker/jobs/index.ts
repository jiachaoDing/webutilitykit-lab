import { SamplingService } from "../services/SamplingService";
import { SyncService } from "../services/SyncService";
import { TierUpdateService } from "../services/TierUpdateService";
import { WfmV1Client } from "../clients/WfmV1Client";
import { WfmV2Client } from "../clients/WfmV2Client";
import { TickRepo } from "../repos/TickRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { SyncStateRepo } from "../repos/SyncStateRepo";
import { JobRunRepo } from "../repos/JobRunRepo";
import { Sharding } from "../domain/Sharding";

export async function handleScheduled(event: any, env: any, ctx: any) {
  const db = env.DB;
  const now = new Date();
  
  // 1. 字典同步任务 (例如每天 UTC 03:00)
  if (event.cron === "0 3 * * *") {
    const syncService = new SyncService(new WfmV2Client(), new SyncStateRepo(db), new WeaponRepo(db));
    const trackedRepo = new TrackedRepo(db);
    const tierUpdateService = new TierUpdateService(db, trackedRepo);
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
      // 设置 25 秒总超时，防止任务长时间挂起
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('SYNC_JOB_TIMEOUT')), 25000)
      );

      const result = await Promise.race([syncService.syncRivens(), timeoutPromise]) as any;
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
        const tierTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('TIER_UPDATE_TIMEOUT')), 25000)
        );
        const tierResult = await Promise.race([tierUpdateService.updateTiers(7, 50), tierTimeoutPromise]) as any;
        await jobRepo.update(tierJobId, 'success', new Date().toISOString(), JSON.stringify(tierResult));
        console.log(`[TierUpdate] Success: ${tierResult.hot_count} hot, ${tierResult.cold_count} cold`);

        // 刷新 DO 的名单缓存
        console.log('[TierUpdate] Notifying DO to refresh lists...');
        const doId = env.RIVEN_COORDINATOR.idFromName("global");
        const coordinator = env.RIVEN_COORDINATOR.get(doId);
        await coordinator.fetch("http://do/refresh-lists", { method: "POST" });
      } catch (tierError: any) {
        console.error(`[TierUpdate] Failed: ${tierError?.message || String(tierError)}`);
        const status = tierError?.message === 'TIER_UPDATE_TIMEOUT' ? 'timeout' : 'fail';
        await jobRepo.update(tierJobId, status, new Date().toISOString(), JSON.stringify({ error: tierError?.message || String(tierError) }));
      }
    } catch (e: any) {
      const status = e?.message === 'SYNC_JOB_TIMEOUT' ? 'timeout' : 'fail';
      await jobRepo.update(jobId, status, new Date().toISOString(), JSON.stringify({ error: e.message }));
    } finally {
      // 额外维护任务：保留 job_run 最近 2 天
      try {
        const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const deleted = await jobRepo.purgeOlderThan(cutoff);
        console.log(`[JobRun] purged older than 2d (${cutoff}), deleted=${deleted}`);
      } catch (e: any) {
        console.error(`[JobRun] purge failed: ${e?.message || String(e)}`);
      }
    }
    return;
  }

  // 2. 价格采样任务（新架构：Cron + Durable Object）
  const windowTs = Sharding.getWindowTs(now);
  const currentMinute = now.getMinutes();
  const isEvenMinute = currentMinute % 2 === 0;

  // 分层采样配置
  const hotBatchSize = isEvenMinute 
    ? Math.max(1, parseInt(env.HOT_BATCH_SIZE_EVEN || "2"))
    : Math.max(1, parseInt(env.HOT_BATCH_SIZE_ODD || "3"));
  
  const coldBatchSize = isEvenMinute 
    ? Math.max(0, parseInt(env.COLD_BATCH_SIZE || "1"))
    : 0;

  const doId = env.RIVEN_COORDINATOR.idFromName("global");
  const coordinator = env.RIVEN_COORDINATOR.get(doId);

  try {
    // A. 问 DO 要本轮要采样的 slugs (内部维护游标)
    const nextBatchResp = await coordinator.fetch(
      `http://do/next-batch?hotBatchSize=${hotBatchSize}&coldBatchSize=${coldBatchSize}`
    );
    if (!nextBatchResp.ok) throw new Error(`DO fetch /next-batch failed: ${nextBatchResp.status}`);
    const { slugs } = (await nextBatchResp.json()) as { slugs: string[] };

    if (slugs.length === 0) {
      console.log('[Sampling] No slugs to sample, list might be empty.');
      return;
    }

    // B. 执行外部 API 采样
    const samplingService = new SamplingService(new WfmV1Client(), new TickRepo(db), new TrackedRepo(db));
    const { samples, stats } = await samplingService.runBatch(slugs, windowTs, { timeBudgetMs: 22000 });

    // C. 将结果通过 DO 写入 D1 并更新内存快照
    const appendResp = await coordinator.fetch("http://do/append-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ts: windowTs, samples })
    });
    if (!appendResp.ok) throw new Error(`DO fetch /append-results failed: ${appendResp.status}`);

    // D. 定期（每 5 分钟）让 DO 同步合并后的快照到 KV
    if (currentMinute % 5 === 0) {
      ctx.waitUntil(coordinator.fetch("http://do/sync-snapshot", { method: "POST" }));
    }

    // E. 记录 Job 审计日志（可选，为了兼容性保留部分结构）
    const jobRepo = new JobRunRepo(db);
    const isHourly = currentMinute === 0;
    if (isHourly || stats.error > 0) {
      await jobRepo.create({
        id: crypto.randomUUID(),
        job_name: 'sample_tick',
        scheduled_ts: windowTs,
        started_at: now.toISOString(),
        finished_at: new Date().toISOString(),
        status: stats.error > 0 ? 'partial' : 'success',
        detail: JSON.stringify({ slugs, stats, windowTs })
      });
    }

  } catch (e: any) {
    console.error(`[Sampling] Job failed: ${e?.message || String(e)}`);
  }
}


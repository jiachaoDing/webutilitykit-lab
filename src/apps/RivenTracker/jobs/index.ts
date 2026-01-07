import { SamplingService } from "../services/SamplingService";
import { SyncService } from "../services/SyncService";
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
    } catch (e: any) {
      await jobRepo.update(jobId, 'fail', new Date().toISOString(), JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 2. 价格采样分片任务 (每 5 分钟触发一次，映射到 shard 0..5)
  const minute = now.getUTCMinutes();
  const shard = Sharding.getShardFromMinute(minute);
  const windowTs = Sharding.getWindowTs(now);

  const samplingService = new SamplingService(new WfmV1Client(), new TickRepo(db), new TrackedRepo(db));
  const jobRepo = new JobRunRepo(db);
  const jobId = crypto.randomUUID();

  await jobRepo.create({
    id: jobId,
    job_name: `sample_shard_${shard}`,
    scheduled_ts: windowTs,
    started_at: now.toISOString(),
    status: 'partial',
    detail: JSON.stringify({ shard, windowTs })
  });

  try {
    const stats = await samplingService.runShard(shard, windowTs);
    await jobRepo.update(jobId, 'success', new Date().toISOString(), JSON.stringify(stats));
  } catch (e: any) {
    await jobRepo.update(jobId, 'fail', new Date().toISOString(), JSON.stringify({ error: e.message }));
  }
}


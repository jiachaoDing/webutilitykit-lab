import { SamplingService } from "../services/SamplingService";
import { SyncService } from "../services/SyncService";
import { ExportService } from "../services/ExportService";
import { CosClient } from "../infra/CosClient";
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
    
    // 如果是最后一个分片 (shard 5)，执行导出并上传到 COS
    if (shard === 5) {
      ctx.waitUntil((async () => {
        try {
          console.log(`[Export] Starting export at window ${windowTs}`);
          const exportService = new ExportService(db);
          const data = await exportService.export30d();
          
          if (env.COS_SECRET_ID && env.COS_SECRET_KEY && env.COS_BUCKET && env.COS_REGION) {
            const cos = new CosClient({
              bucket: env.COS_BUCKET,
              region: env.COS_REGION,
              secretId: env.COS_SECRET_ID,
              secretKey: env.COS_SECRET_KEY
            });
            
            const key = env.COS_OBJECT_KEY_LATEST || 'riven/export-30d-latest.json';
            await cos.putObject(key, JSON.stringify(data));
            console.log(`[Export] Successfully uploaded to COS: ${key}`);
          } else {
            console.warn('[Export] COS configuration missing, skipping upload.');
          }
        } catch (err: any) {
          console.error(`[Export] Failed: ${err.message}`);
        }
      })());
    }

    await jobRepo.update(jobId, 'success', new Date().toISOString(), JSON.stringify(stats));
  } catch (e: any) {
    await jobRepo.update(jobId, 'fail', new Date().toISOString(), JSON.stringify({ error: e.message }));
  }
}


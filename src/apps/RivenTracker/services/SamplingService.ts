import { WfmV1Client } from "../clients/WfmV1Client";
import { TickRepo } from "../repos/TickRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { BottomPriceCalculator } from "../domain/BottomPriceCalculator";
import { Sharding } from "../domain/Sharding";
import { RateLimiter } from "../infra/RateLimiter";
import { Tick } from "../domain/types";

export class SamplingService {
  private limiter = new RateLimiter(2); // 限制 2 RPS

  constructor(
    private wfmClient: WfmV1Client,
    private tickRepo: TickRepo,
    private trackedRepo: TrackedRepo
  ) {}

  /**
   * 执行特定分片的采样任务
   */
  async runShard(shard: number, windowTs: string) {
    // 1. 获取本分片需要采样的武器
    const allTracked = await this.trackedRepo.getEnabledTracked();
    const shardTracked = allTracked.filter(w => Sharding.getShard(w.slug) === shard);

    const stats = { 
      total: shardTracked.length, 
      ok: 0, 
      no_data: 0, 
      error: 0, 
      errors: [] as { weapon: string, error: string }[] 
    };

    // 2. 依次处理 (考虑到 RPS 限制，顺序处理在 Workers 环境下更易控)
    for (const weapon of shardTracked) {
      try {
        // 节流
        await this.limiter.throttle();

        const auctions = await this.wfmClient.searchAuctions(weapon.slug);
        const result = BottomPriceCalculator.calculate(auctions);

        const tick: Tick = {
          ts: windowTs,
          platform: 'pc',
          weapon_slug: weapon.slug,
          bottom_price: result.bottom_price,
          sample_count: result.sample_count,
          active_count: result.active_count, // 传递活跃总数
          min_price: result.min_price,
          p5_price: result.p5_price,
          p10_price: result.p10_price, // 新增
          created_at: new Date().toISOString(),
          source_status: result.status
        };

        await this.tickRepo.upsertTick(tick);

        if (result.status === 'ok') stats.ok++;
        else stats.no_data++;

      } catch (e: any) {
        stats.error++;
        stats.errors.push({ weapon: weapon.slug, error: e.message });

        // 记录错误 Tick 以便前端展示异常点
        await this.tickRepo.upsertTick({
          ts: windowTs,
          platform: 'pc',
          weapon_slug: weapon.slug,
          bottom_price: null,
          sample_count: 0,
          active_count: 0,
          min_price: null,
          p5_price: null,
          p10_price: null,
          created_at: new Date().toISOString(),
          source_status: 'error',
          error_code: e.message === 'WFM_LIMIT_REACHED' ? 'HTTP_429' : 'UNKNOWN'
        });
      }
    }

    return stats;
  }
}


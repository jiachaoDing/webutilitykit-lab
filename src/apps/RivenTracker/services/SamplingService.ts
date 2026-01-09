import { WfmV1Client } from "../clients/WfmV1Client";
import { TickRepo } from "../repos/TickRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { BottomPriceCalculator } from "../domain/BottomPriceCalculator";
import { RateLimiter } from "../infra/RateLimiter";
import { Tick } from "../domain/types";

export class SamplingService {
  private limiter = new RateLimiter(2); 
  private wfmTimeoutMs = 5000; 
  private wfmTimeoutRetryOnce = true; 

  constructor(
    private wfmClient: WfmV1Client,
    private tickRepo: TickRepo,
    private trackedRepo: TrackedRepo
  ) {}

  /**
   * 执行指定列表的采样（新架构：由 DO 控制列表）
   */
  async runBatch(
    slugs: string[],
    windowTs: string,
    options?: { timeBudgetMs?: number },
  ): Promise<{ samples: Tick[]; stats: any }> {
    const timeBudgetMs = Math.max(1000, options?.timeBudgetMs ?? 25000);
    const deadline = Date.now() + timeBudgetMs;

    const samples: Tick[] = [];
    const stats = {
      ok: 0,
      no_data: 0,
      error: 0,
      errors: [] as { weapon: string; error: string }[],
      stopped_by_deadline: false,
    };

    for (const slug of slugs) {
      if (Date.now() > deadline) {
        stats.stopped_by_deadline = true;
        break;
      }

      try {
        const auctions = await this.fetchAuctionsWithTimeoutRetry(slug, deadline);
        const calcResult = BottomPriceCalculator.calculate(auctions);

        const tick: Tick = {
          ts: windowTs,
          platform: 'pc',
          weapon_slug: slug,
          bottom_price: calcResult.bottom_price,
          sample_count: calcResult.sample_count,
          active_count: calcResult.active_count,
          min_price: calcResult.min_price,
          p5_price: calcResult.p5_price,
          p10_price: calcResult.p10_price,
          created_at: new Date().toISOString(),
          source_status: calcResult.status
        };

        samples.push(tick);
        if (calcResult.status === 'ok') stats.ok++;
        else stats.no_data++;

      } catch (e: any) {
        stats.error++;
        stats.errors.push({ weapon: slug, error: e.message });

        samples.push({
          ts: windowTs,
          platform: 'pc',
          weapon_slug: slug,
          bottom_price: null,
          sample_count: 0,
          active_count: 0,
          min_price: null,
          p5_price: null,
          p10_price: null,
          created_at: new Date().toISOString(),
          source_status: 'error',
          error_code: e.message === 'WFM_LIMIT_REACHED' ? 'HTTP_429' : e.message === 'WFM_TIMEOUT' ? 'TIMEOUT' : 'UNKNOWN'
        });
      }
    }

    return { samples, stats };
  }

  private async fetchAuctionsWithTimeoutRetry(weaponSlug: string, deadlineMs: number) {
    if (Date.now() > deadlineMs) throw new Error("DEADLINE");
    await this.limiter.throttle();
    try {
      return await this.wfmClient.searchAuctions(weaponSlug, { timeoutMs: this.wfmTimeoutMs });
    } catch (e: any) {
      if (e?.message !== "WFM_TIMEOUT" || !this.wfmTimeoutRetryOnce) throw e;
      const retryBudget = 200 + this.wfmTimeoutMs + 200;
      if (Date.now() + retryBudget > deadlineMs) throw e;
      await new Promise((r) => setTimeout(r, 200));
      await this.limiter.throttle();
      return await this.wfmClient.searchAuctions(weaponSlug, { timeoutMs: this.wfmTimeoutMs });
    }
  }
}

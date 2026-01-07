import { WfmV1Client } from "../clients/WfmV1Client";
import { TickRepo } from "../repos/TickRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { BottomPriceCalculator } from "../domain/BottomPriceCalculator";
import { Sharding } from "../domain/Sharding";
import { RateLimiter } from "../infra/RateLimiter";
import { Tick } from "../domain/types";

export interface TieredBatchResult {
  windowTs: string;
  total_hot: number;
  total_cold: number;
  cursor_hot_before: number;
  cursor_hot_after: number;
  cursor_cold_before: number;
  cursor_cold_after: number;
  processed_hot: number;
  processed_cold: number;
  ok: number;
  no_data: number;
  error: number;
  errors: { weapon: string; error: string }[];
  stopped_by_deadline: boolean;
}

export class SamplingService {
  private limiter = new RateLimiter(2); // 限制 2 RPS
  private wfmTimeoutMs = 5000; // 单次 WFM 请求超时（避免 cron 挂死）
  private wfmTimeoutRetryOnce = true; // 仅对超时重试 1 次

  constructor(
    private wfmClient: WfmV1Client,
    private tickRepo: TickRepo,
    private trackedRepo: TrackedRepo
  ) {}

  /**
   * 执行"分层游标批处理"采样任务：
   * - 每分钟采样 5 把热门武器（tier='hot'）+ 1 把冷门武器（tier='cold'）
   * - 分别维护两个游标，确保所有武器都能被轮询到
   */
  async runTieredBatch(
    cursorHot: number,
    cursorCold: number,
    hotBatchSize: number,
    coldBatchSize: number,
    windowTs: string,
    options?: { timeBudgetMs?: number },
  ): Promise<TieredBatchResult> {
    const timeBudgetMs = Math.max(1000, options?.timeBudgetMs ?? 25000);
    const deadline = Date.now() + timeBudgetMs;

    const [hotList, coldList] = await Promise.all([
      this.trackedRepo.getEnabledByTier('hot'),
      this.trackedRepo.getEnabledByTier('cold'),
    ]);

    const totalHot = hotList.length;
    const totalCold = coldList.length;

    const normalizedCursorHot = totalHot > 0 ? ((cursorHot % totalHot) + totalHot) % totalHot : 0;
    const normalizedCursorCold = totalCold > 0 ? ((cursorCold % totalCold) + totalCold) % totalCold : 0;

    const result: TieredBatchResult = {
      windowTs,
      total_hot: totalHot,
      total_cold: totalCold,
      cursor_hot_before: normalizedCursorHot,
      cursor_hot_after: normalizedCursorHot,
      cursor_cold_before: normalizedCursorCold,
      cursor_cold_after: normalizedCursorCold,
      processed_hot: 0,
      processed_cold: 0,
      ok: 0,
      no_data: 0,
      error: 0,
      errors: [],
      stopped_by_deadline: false,
    };

    // 构建采样计划：5 把热门 + 1 把冷门（交替采样）
    const plan: { slug: string; tier: 'hot' | 'cold' }[] = [];

    // 先添加热门武器
    if (totalHot > 0) {
      for (let i = 0; i < hotBatchSize; i++) {
        const idx = (normalizedCursorHot + i) % totalHot;
        plan.push({ slug: hotList[idx].slug, tier: 'hot' });
      }
    }

    // 再添加冷门武器
    if (totalCold > 0) {
      for (let i = 0; i < coldBatchSize; i++) {
        const idx = (normalizedCursorCold + i) % totalCold;
        plan.push({ slug: coldList[idx].slug, tier: 'cold' });
      }
    }

    if (plan.length === 0) return result;

    // 依次处理采样计划
    for (const item of plan) {
      if (Date.now() > deadline) {
        result.stopped_by_deadline = true;
        break;
      }

      try {
        const auctions = await this.fetchAuctionsWithTimeoutRetry(item.slug, deadline);
        const calcResult = BottomPriceCalculator.calculate(auctions);

        const tick: Tick = {
          ts: windowTs,
          platform: 'pc',
          weapon_slug: item.slug,
          bottom_price: calcResult.bottom_price,
          sample_count: calcResult.sample_count,
          active_count: calcResult.active_count,
          min_price: calcResult.min_price,
          p5_price: calcResult.p5_price,
          p10_price: calcResult.p10_price,
          created_at: new Date().toISOString(),
          source_status: calcResult.status
        };

        await this.tickRepo.upsertTick(tick);

        if (calcResult.status === 'ok') result.ok++;
        else result.no_data++;

        if (item.tier === 'hot') result.processed_hot++;
        else result.processed_cold++;

      } catch (e: any) {
        result.error++;
        result.errors.push({ weapon: item.slug, error: e.message });

        if (item.tier === 'hot') result.processed_hot++;
        else result.processed_cold++;

        // 记录错误 Tick
        try {
          await this.tickRepo.upsertTick({
            ts: windowTs,
            platform: 'pc',
            weapon_slug: item.slug,
            bottom_price: null,
            sample_count: 0,
            active_count: 0,
            min_price: null,
            p5_price: null,
            p10_price: null,
            created_at: new Date().toISOString(),
            source_status: 'error',
            error_code:
              e.message === 'WFM_LIMIT_REACHED' ? 'HTTP_429'
              : e.message === 'WFM_TIMEOUT' ? 'TIMEOUT'
              : 'UNKNOWN'
          });
        } catch (writeErr: any) {
          result.errors.push({ weapon: item.slug, error: `tick_write_failed:${writeErr?.message || String(writeErr)}` });
        }
      }
    }

    // 更新游标位置
    result.cursor_hot_after = (normalizedCursorHot + result.processed_hot) % Math.max(1, totalHot);
    result.cursor_cold_after = (normalizedCursorCold + result.processed_cold) % Math.max(1, totalCold);

    return result;
  }

  /**
   * 执行"游标批处理"采样任务：每分钟只采样一小批武器，并保存游标进度
   * @deprecated 使用 runTieredBatch 替代（支持分层采样）
   */
  async runBatch(
    cursor: number,
    batchSize: number,
    windowTs: string,
    options?: { timeBudgetMs?: number },
  ) {
    const allTracked = await this.trackedRepo.getEnabledTracked();
    const list = [...allTracked].sort((a, b) => {
      // priority DESC, slug ASC（稳定）
      const p = (b.priority ?? 0) - (a.priority ?? 0);
      if (p !== 0) return p;
      return a.slug.localeCompare(b.slug);
    });

    const total = list.length;
    const timeBudgetMs = Math.max(1000, options?.timeBudgetMs ?? 25000);
    const deadline = Date.now() + timeBudgetMs;

    const normalizedCursor = total > 0 ? ((cursor % total) + total) % total : 0;

    const stats = {
      total_tracked: total,
      batch_size: batchSize,
      cursor_before: normalizedCursor,
      cursor_after: normalizedCursor,
      processed: 0,
      ok: 0,
      no_data: 0,
      error: 0,
      errors: [] as { weapon: string; error: string }[],
      stopped_by_deadline: false,
    };

    if (total === 0 || batchSize <= 0) return stats;

    // 计算本次要处理的武器序列（允许 wrap）
    const planned: { slug: string }[] = [];
    for (let i = 0; i < batchSize; i++) {
      planned.push(list[(normalizedCursor + i) % total]);
    }

    // 2. 依次处理 (考虑到 RPS 限制，顺序处理在 Workers 环境下更易控)
    for (const weapon of planned) {
      if (Date.now() > deadline) {
        stats.stopped_by_deadline = true;
        break;
      }
      try {
        const auctions = await this.fetchAuctionsWithTimeoutRetry(weapon.slug, deadline);
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
        stats.processed++;

      } catch (e: any) {
        stats.error++;
        stats.errors.push({ weapon: weapon.slug, error: e.message });
        stats.processed++;

        // 记录错误 Tick 以便前端展示异常点
        try {
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
            error_code:
              e.message === 'WFM_LIMIT_REACHED' ? 'HTTP_429'
              : e.message === 'WFM_TIMEOUT' ? 'TIMEOUT'
              : 'UNKNOWN'
          });
        } catch (writeErr: any) {
          // 即使写 error tick 失败，也不要让整个批次中断
          stats.errors.push({ weapon: weapon.slug, error: `tick_write_failed:${writeErr?.message || String(writeErr)}` });
        }
      }
    }

    stats.cursor_after = (normalizedCursor + stats.processed) % total;
    return stats;
  }

  private async fetchAuctionsWithTimeoutRetry(weaponSlug: string, deadlineMs: number) {
    // attempt 1
    if (Date.now() > deadlineMs) throw new Error("DEADLINE");
    await this.limiter.throttle();
    try {
      return await this.wfmClient.searchAuctions(weaponSlug, { timeoutMs: this.wfmTimeoutMs });
    } catch (e: any) {
      if (e?.message !== "WFM_TIMEOUT" || !this.wfmTimeoutRetryOnce) throw e;

      // 仅当还剩足够时间才重试，否则直接抛出 timeout
      const retryBudget = 200 + this.wfmTimeoutMs + 200;
      if (Date.now() + retryBudget > deadlineMs) throw e;

      await new Promise((r) => setTimeout(r, 200));
      await this.limiter.throttle();
      return await this.wfmClient.searchAuctions(weaponSlug, { timeoutMs: this.wfmTimeoutMs });
    }
  }
}


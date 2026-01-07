import { TrackedRepo } from "../repos/TrackedRepo";
import { d1WithRetry } from "../infra/d1Retry";

export interface WeaponPriceStats {
  weapon_slug: string;
  avg_bottom_price: number;
  sample_count: number;
}

export interface TierUpdateResult {
  updated_at: string;
  total_tracked: number;
  hot_count: number;
  cold_count: number;
  stats_days: number;
  top_hot_weapons: string[];
}

/**
 * 武器分层更新服务
 * 
 * 功能：根据最近 N 天的价格数据，计算每个武器的平均底价，
 * 将排名前 50 的武器标记为 'hot'（热门），其余标记为 'cold'（冷门）。
 * 
 * 调用时机：每天 UTC 03:00 在字典同步任务后自动执行
 */
export class TierUpdateService {
  constructor(
    private db: D1Database,
    private trackedRepo: TrackedRepo
  ) {}

  /**
   * 更新武器分层
   * @param days 统计最近 N 天的数据（默认 7 天）
   * @param hotThreshold 热门武器数量阈值（默认 50）
   */
  async updateTiers(
    days: number = 7,
    hotThreshold: number = 50
  ): Promise<TierUpdateResult> {
    const now = new Date();
    const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // 1. 获取所有已追踪的武器
    const allTracked = await this.trackedRepo.getEnabledTracked();
    const trackedSlugs = new Set(allTracked.map(w => w.slug));

    if (trackedSlugs.size === 0) {
      return {
        updated_at: now.toISOString(),
        total_tracked: 0,
        hot_count: 0,
        cold_count: 0,
        stats_days: days,
        top_hot_weapons: []
      };
    }

    // 2. 从 riven_bottom_tick 表查询最近 N 天的价格数据，计算每个武器的平均底价
    const priceStats = await this.calculateAveragePrices(startTime.toISOString(), Array.from(trackedSlugs));

    // 3. 按平均价格降序排序
    priceStats.sort((a, b) => b.avg_bottom_price - a.avg_bottom_price);

    // 4. 确定分层：前 hotThreshold 名为 'hot'，其余为 'cold'
    const hotWeapons = new Set(priceStats.slice(0, hotThreshold).map(s => s.weapon_slug));

    // 5. 批量更新 tier
    const updates: { slug: string; tier: 'hot' | 'cold' }[] = [];
    for (const weapon of allTracked) {
      const tier = hotWeapons.has(weapon.slug) ? 'hot' : 'cold';
      updates.push({ slug: weapon.slug, tier });
    }

    await this.trackedRepo.batchUpdateTiers(updates);

    // 6. 返回更新结果
    const result: TierUpdateResult = {
      updated_at: now.toISOString(),
      total_tracked: allTracked.length,
      hot_count: hotWeapons.size,
      cold_count: allTracked.length - hotWeapons.size,
      stats_days: days,
      top_hot_weapons: Array.from(hotWeapons).slice(0, 10)
    };

    console.log(`[TierUpdate] Updated weapon tiers: ${result.hot_count} hot, ${result.cold_count} cold`);
    return result;
  }

  /**
   * 计算每个武器的平均底价（基于最近 N 天的 tick 数据）
   * 使用最近 N 天内的 bottom_price 均值，不限制最小采样次数
   */
  private async calculateAveragePrices(
    startTs: string,
    trackedSlugs: string[]
  ): Promise<WeaponPriceStats[]> {
    // D1 SQL 参数数量限制，每批最多 50 个武器（加上 startTs 参数，总共 51 个）
    const batchSize = 50;
    const allStats: WeaponPriceStats[] = [];

    for (let i = 0; i < trackedSlugs.length; i += batchSize) {
      const batch = trackedSlugs.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');

      const { results } = await d1WithRetry("tier_update.calculateAveragePrices", () =>
        this.db.prepare(`
          SELECT 
            weapon_slug,
            AVG(bottom_price) as avg_bottom_price,
            COUNT(*) as sample_count
          FROM riven_bottom_tick
          WHERE 
            platform = 'pc'
            AND ts >= ?
            AND source_status = 'ok'
            AND bottom_price IS NOT NULL
            AND weapon_slug IN (${placeholders})
          GROUP BY weapon_slug
        `).bind(startTs, ...batch).all<{
          weapon_slug: string;
          avg_bottom_price: number;
          sample_count: number;
        }>()
      );

      allStats.push(...results);
    }

    // 对于在最近 N 天内没有价格数据的武器，标记为冷门（平均价格 0）
    const hasDataSlugs = new Set(allStats.map(s => s.weapon_slug));
    for (const slug of trackedSlugs) {
      if (!hasDataSlugs.has(slug)) {
        allStats.push({
          weapon_slug: slug,
          avg_bottom_price: 0,
          sample_count: 0
        });
      }
    }

    return allStats;
  }
}


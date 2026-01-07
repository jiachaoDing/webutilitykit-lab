import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { Tick, AggregatedTick } from "../domain/types";

export class TrendService {
  constructor(
    private tickRepo: TickRepo,
    private weaponRepo: WeaponRepo,
    private trackedRepo?: TrackedRepo
  ) {}

  /**
   * 获取价格趋势
   */
  async getTrend(weaponSlug: string, range: string, platform: string = 'pc', mode: string = 'raw') {
    const now = new Date();
    let startTime: Date;

    // 解析范围
    const rangeMap: Record<string, number> = {
      '24h': 1,
      '1h': 1,    // 聚合模式：1小时区间显示24小时数据
      '4h': 7,    // 聚合模式：4小时区间显示7天数据
      '1d': 30,   // 聚合模式：1天区间显示30天数据
      '48h': 2,
      '7d': 7,
      '30d': 30,
      '90d': 90
    };
    const days = rangeMap[range] || 30;
    startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    let ticks = await this.tickRepo.getTrend(weaponSlug, platform, startTime.toISOString());
    const latestTick = await this.tickRepo.getLatestTick(weaponSlug, platform);

    // 如果是聚合模式，进行数据聚合
    let aggregated = false;
    let aggregatedTicks: AggregatedTick[] = [];
    if (mode === 'aggregated') {
      aggregatedTicks = this.aggregateTicks(ticks, range);
      aggregated = true;
    }

    return {
      meta: {
        weapon: weaponSlug,
        platform,
        range,
        mode,
        aggregated,
        interval_minutes: mode === 'aggregated' ? this.getAggregationIntervalMinutes(range) : 30,
        calculation: "ingame_only; top5_weighted_buyout; outlier_drop_p1_if_p1_lt_0.6_mean(p2,p3)",
        last_updated_utc: latestTick?.ts || null
      },
      data: aggregated ? aggregatedTicks.map(t => ({
        ts: t.ts,
        bottom_price: t.bottom_price,
        sample_count: t.sample_count,
        active_count: t.active_count,
        min_price: t.min_price,
        p5_price: t.p5_price,
        p10_price: t.p10_price,
        status: t.status,
        aggregated_count: t.aggregated_count
      })) : ticks.map(t => ({
        ts: t.ts,
        bottom_price: t.bottom_price,
        sample_count: t.sample_count,
        active_count: t.active_count,
        min_price: t.min_price,
        p5_price: t.p5_price,
        p10_price: t.p10_price,
        status: t.source_status
      }))
    };
  }

  /**
   * 聚合采样数据
   */
  private aggregateTicks(ticks: any[], range: string) {
    if (!ticks || ticks.length === 0) return [];

    // 根据range确定聚合间隔（毫秒）
    const intervalMs = {
      '1h': 60 * 60 * 1000,      // 1小时
      '4h': 4 * 60 * 60 * 1000,  // 4小时
      '1d': 24 * 60 * 60 * 1000   // 1天
    }[range] || (24 * 60 * 60 * 1000); // 默认1天

    // 按时间间隔分组
    const grouped: Record<string, any> = {};
    ticks.forEach(tick => {
      const timestamp = new Date(tick.ts).getTime();
      const intervalStart = Math.floor(timestamp / intervalMs) * intervalMs;
      const key = intervalStart.toString();

      if (!grouped[key]) {
        grouped[key] = {
          timestamps: [],
          bottom_prices: [],
          min_prices: [],
          active_counts: [],
          sample_counts: [],
          p5_prices: [],
          p10_prices: [],
          statuses: []
        };
      }

      grouped[key].timestamps.push(timestamp);
      if (tick.bottom_price !== null && tick.bottom_price !== undefined) {
        grouped[key].bottom_prices.push(tick.bottom_price);
      }
      if (tick.min_price !== null && tick.min_price !== undefined) {
        grouped[key].min_prices.push(tick.min_price);
      }
      if (tick.active_count !== null && tick.active_count !== undefined) {
        grouped[key].active_counts.push(tick.active_count);
      }
      if (tick.sample_count !== null && tick.sample_count !== undefined) {
        grouped[key].sample_counts.push(tick.sample_count);
      }
      if (tick.p5_price !== null && tick.p5_price !== undefined) {
        grouped[key].p5_prices.push(tick.p5_price);
      }
      if (tick.p10_price !== null && tick.p10_price !== undefined) {
        grouped[key].p10_prices.push(tick.p10_price);
      }
      if (tick.status) {
        grouped[key].statuses.push(tick.status);
      }
    });

    // 计算每组的平均值
    return Object.keys(grouped).map(key => {
      const group = grouped[key];
      const intervalStart = parseInt(key);

      return {
        ts: new Date(intervalStart).toISOString(),
        bottom_price: group.bottom_prices.length > 0 ? Math.round(group.bottom_prices.reduce((a: number, b: number) => a + b, 0) / group.bottom_prices.length) : null,
        min_price: group.min_prices.length > 0 ? Math.round(group.min_prices.reduce((a: number, b: number) => a + b, 0) / group.min_prices.length) : null,
        active_count: group.active_counts.length > 0 ? Math.round(group.active_counts.reduce((a: number, b: number) => a + b, 0) / group.active_counts.length) : null,
        sample_count: group.sample_counts.length > 0 ? Math.round(group.sample_counts.reduce((a: number, b: number) => a + b, 0) / group.sample_counts.length) : null,
        p5_price: group.p5_prices.length > 0 ? Math.round(group.p5_prices.reduce((a: number, b: number) => a + b, 0) / group.p5_prices.length) : null,
        p10_price: group.p10_prices.length > 0 ? Math.round(group.p10_prices.reduce((a: number, b: number) => a + b, 0) / group.p10_prices.length) : null,
        status: group.statuses.length > 0 ? group.statuses[Math.floor(group.statuses.length / 2)] : null, // 中位数状态
        aggregated_count: group.timestamps.length
      };
    }).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }

  /**
   * 获取聚合间隔的分钟数
   */
  private getAggregationIntervalMinutes(range: string): number {
    const intervals = {
      '1h': 60,      // 1小时
      '4h': 240,     // 4小时
      '1d': 1440     // 1天
    };
    return intervals[range as keyof typeof intervals] || 1440;
  }

  /**
   * 获取当前底价快照
   */
  async getLatest(weaponSlug: string, platform: string = 'pc') {
    const tick = await this.tickRepo.getLatestTick(weaponSlug, platform);
    return { data: tick };
  }

  /**
   * 搜索武器
   */
  async searchWeapons(q: string, limit: number = 20) {
    const results = await this.weaponRepo.search(q, limit);
    return { data: results };
  }

  /**
   * 获取热门武器
   */
  async getHotWeapons(limit: number = 10, sortBy: 'active_count' | 'price' = 'price') {
    const results = await this.tickRepo.getLatestHotWeapons(limit, sortBy);
    return { data: results };
  }

  /**
   * 获取武器的缓存时间（基于 tier）
   * @returns 缓存时间（秒）
   */
  async getCacheTTL(weaponSlug: string): Promise<number> {
    if (!this.trackedRepo) return 300; // 默认 5 分钟
    
    try {
      // 查询武器的 tier
      const weapons = await this.trackedRepo.getEnabledTracked();
      const weapon = weapons.find(w => w.slug === weaponSlug);
      
      if (!weapon) return 300; // 未追踪的武器，默认 5 分钟
      
      // 根据 tier 返回不同的缓存时间
      if (weapon.tier === 'hot') {
        return 300; // 热门武器：5 分钟
      } else {
        return 7200; // 冷门武器：2 小时
      }
    } catch (e) {
      console.error('[TrendService] getCacheTTL failed:', e);
      return 300; // 出错时默认 5 分钟
    }
  }
}


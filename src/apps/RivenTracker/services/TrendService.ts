import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { TrackedRepo } from "../repos/TrackedRepo";

export class TrendService {
  constructor(
    private tickRepo: TickRepo,
    private weaponRepo: WeaponRepo,
    private trackedRepo?: TrackedRepo
  ) {}

  /**
   * 获取价格趋势
   */
  async getTrend(weaponSlug: string, range: string, platform: string = 'pc') {
    const now = new Date();
    let startTime: Date;

    // 解析范围
    const rangeMap: Record<string, number> = {
      '24h': 1,
      '48h': 2,
      '7d': 7,
      '30d': 30,
      '90d': 90
    };
    const days = rangeMap[range] || 30;
    startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const ticks = await this.tickRepo.getTrend(weaponSlug, platform, startTime.toISOString());
    const latestTick = await this.tickRepo.getLatestTick(weaponSlug, platform);

    return {
      meta: {
        weapon: weaponSlug,
        platform,
        range,
        interval_minutes: 30,
        calculation: "ingame_only; top5_weighted_buyout; outlier_drop_p1_if_p1_lt_0.6_mean(p2,p3)",
        last_updated_utc: latestTick?.ts || null
      },
      data: ticks.map(t => ({
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


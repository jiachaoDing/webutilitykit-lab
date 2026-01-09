import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";
import { TrackedRepo } from "../repos/TrackedRepo";
import { Tick, AggregatedTick } from "../domain/types";

export class TrendService {
  constructor(
    private tickRepo: TickRepo,
    private weaponRepo: WeaponRepo,
    private trackedRepo?: TrackedRepo,
    private kv?: KVNamespace,
    private coordinator?: DurableObjectNamespace
  ) {}

  /**
   * 获取价格趋势
   */
  async getTrend(weaponSlug: string, range: string, platform: string = 'pc', mode: string = 'raw') {
    // 1. 尝试从 DO 内存缓存获取近期历史 (针对 raw 模式或 1h 区间请求)
    // mode=raw 默认返回最近 100 条原始数据，不再受 rangeMap 限制
    if (this.coordinator && (mode === 'raw' || range === '1h')) {
      try {
        const doId = this.coordinator.idFromName("global");
        const stub = this.coordinator.get(doId);
        const resp = await stub.fetch(`http://do/recent-history?slug=${weaponSlug}`);
        if (resp.ok) {
          const history = (await resp.json()) as Tick[];
          if (history.length > 0) {
            // 如果是聚合模式，直接对内存中的原始数据进行聚合计算
            const isAggregated = mode === 'aggregated';
            const displayData = isAggregated ? this.aggregateTicks(history, range) : history;

            return {
              meta: {
                weapon: weaponSlug,
                platform,
                range: mode === 'raw' ? 'recent_100' : range,
                mode,
                aggregated: isAggregated,
                interval_minutes: isAggregated ? this.getAggregationIntervalMinutes(range) : 1,
                source: 'do_memory',
                last_updated_utc: history[history.length - 1].ts,
                calculation: "ingame_only; top5_weighted_buyout; outlier_drop_p1_if_p1_lt_0.6_mean(p2,p3)"
              },
              data: displayData.map((t: any) => ({
                ts: t.ts,
                bottom_price: t.bottom_price,
                sample_count: t.sample_count,
                active_count: t.active_count,
                min_price: t.min_price,
                p5_price: t.p5_price,
                p10_price: t.p10_price,
                status: isAggregated ? t.status : t.source_status,
                aggregated_count: isAggregated ? t.aggregated_count : undefined
              }))
            };
          }
        }
      } catch (e) {
        console.error("[TrendService] DO cache fetch failed:", e);
      }
    }

    // 2. 尝试从 KV 读取趋势缓存 (针对 D1 查询结果)
    const cacheKey = `riven:trend:${platform}:${weaponSlug}:${range}:${mode}`;
    if (this.kv) {
      const cached = await this.kv.get(cacheKey);
      if (cached) {
        try {
          return { ...JSON.parse(cached), source: 'kv_trend' };
        } catch {}
      }
    }

    const now = new Date();
    let startTime: Date;

    // 解析范围
    const rangeMap: Record<string, number> = {
      '1h': 1,    // 24 小时
      '4h': 7,    // 7 天
      '1d': 30,   // 30 天
    };
    const days = rangeMap[range] || 30;
    startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // 3. 决定是否使用 SQL 级别聚合
    // 针对长跨度（>= 7天）且开启聚合模式的请求，直接让数据库进行 GROUP BY
    const useSqlAggregation = mode === 'aggregated' && days >= 7;
    
    let displayData: any[] = [];
    let aggregated = mode === 'aggregated';
    const latestTick = await this.tickRepo.getLatestTick(weaponSlug, platform);

    if (useSqlAggregation) {
      // 根据 range 决定 SQL 聚合颗粒度
      let interval: 'day' | 'hour' | '4hour' = 'day';
      if (range === '1h') interval = 'hour';
      else if (range === '4h') interval = '4hour';
      
      displayData = await this.tickRepo.getAggregatedTrend(weaponSlug, platform, startTime.toISOString(), interval);
    } else {
      // 原始模式或短跨度：拉取原始数据
      const ticks = await this.tickRepo.getTrend(weaponSlug, platform, startTime.toISOString());
      if (aggregated) {
        displayData = this.aggregateTicks(ticks, range);
      } else {
        displayData = ticks.map(t => ({ ...t, status: t.source_status }));
      }
    }

    const result = {
      meta: {
        weapon: weaponSlug,
        platform,
        range,
        mode,
        aggregated,
        interval_minutes: aggregated ? this.getAggregationIntervalMinutes(range) : 30,
        calculation: "ingame_only; top5_weighted_buyout; outlier_drop_p1_if_p1_lt_0.6_mean(p2,p3)",
        last_updated_utc: latestTick?.ts || null,
        source: useSqlAggregation ? 'd1_sql_agg' : 'd1_raw'
      },
      data: displayData.map(t => ({
        ts: t.ts,
        bottom_price: t.bottom_price,
        sample_count: t.sample_count,
        active_count: t.active_count,
        min_price: t.min_price,
        p5_price: t.p5_price,
        p10_price: t.p10_price,
        status: t.status,
        aggregated_count: t.aggregated_count
      }))
    };

    // 3. 异步存入 KV 缓存 (针对长周期或聚合请求，延长至 4 小时以节省额度)
    if (this.kv) {
      const kv = this.kv;
      // 1h Raw 模式若漏到 D1 查询，给 5 分钟缓存；
      // 其余长周期或聚合查询，一律给 4 小时 (14400s)
      const ttl = (range === '1h' && mode === 'raw') ? 300 : 14400;
      kv.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl }).catch(() => {});
    }

    return result;
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
    // 1. 优先尝试从合并后的 KV 快照读取 (riven:latest:pc)
    if (this.kv) {
      const bundleKey = `riven:latest:${platform}`;
      const cachedBundle = await this.kv.get(bundleKey);
      if (cachedBundle) {
        try {
          const bundle = JSON.parse(cachedBundle);
          if (bundle[weaponSlug]) {
            return { data: bundle[weaponSlug], source: 'kv_bundle' };
          }
        } catch {}
      }
    }

    // 2. 降级查 D1
    const tick = await this.tickRepo.getLatestTick(weaponSlug, platform);
    return { data: tick, source: 'd1' };
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
  async getNewHotWeapons(limit: number = 10, sortBy: 'active_count' | 'price' = 'price') {
    const cacheKey = `riven:hotlist:${sortBy}:${limit}`;
    
    // 1. 尝试从 KV 读取缓存的热门榜单
    if (this.kv) {
      const cached = await this.kv.get(cacheKey);
      if (cached) {
        try {
          return { ...JSON.parse(cached), source: 'kv' };
        } catch {}
      }
    }

    // 2. 查 D1
    const results = await this.tickRepo.getLatestHotWeapons(limit, sortBy);
    
    // 3. 异步写入缓存（有效期 5 分钟，避免榜单频繁刷新）
    const result = { data: results, source: 'd1' };
    if (this.kv && results.length > 0) {
      this.kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 }).catch(() => {});
    }

    return result;
  }

}


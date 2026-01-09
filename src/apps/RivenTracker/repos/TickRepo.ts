import { Tick } from "../domain/types";
import { d1WithRetry } from "../infra/d1Retry";

export class TickRepo {
  constructor(private db: D1Database) {}

  async upsertTick(tick: Tick) {
    return d1WithRetry("riven_bottom_tick.upsertTick", () =>
      this.db.prepare(`
        INSERT INTO riven_bottom_tick (ts, platform, weapon_slug, bottom_price, sample_count, active_count, min_price, p5_price, p10_price, created_at, source_status, error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ts, platform, weapon_slug) DO UPDATE SET
          bottom_price = excluded.bottom_price,
          sample_count = excluded.sample_count,
          active_count = excluded.active_count,
          min_price = excluded.min_price,
          p5_price = excluded.p5_price,
          p10_price = excluded.p10_price,
          created_at = excluded.created_at,
          source_status = excluded.source_status,
          error_code = excluded.error_code
      `).bind(
        tick.ts, tick.platform, tick.weapon_slug,
        tick.bottom_price, tick.sample_count, tick.active_count || 0, tick.min_price, tick.p5_price, tick.p10_price,
        tick.created_at, tick.source_status, tick.error_code || null,
      ).run(),
    );
  }

  /**
   * 批量更新 Ticks
   */
  async batchUpsertTicks(ticks: Tick[]) {
    const statements = ticks.map(tick => 
      this.db.prepare(`
        INSERT INTO riven_bottom_tick (ts, platform, weapon_slug, bottom_price, sample_count, active_count, min_price, p5_price, p10_price, created_at, source_status, error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ts, platform, weapon_slug) DO UPDATE SET
          bottom_price = excluded.bottom_price,
          sample_count = excluded.sample_count,
          active_count = excluded.active_count,
          min_price = excluded.min_price,
          p5_price = excluded.p5_price,
          p10_price = excluded.p10_price,
          created_at = excluded.created_at,
          source_status = excluded.source_status,
          error_code = excluded.error_code
      `).bind(
        tick.ts, tick.platform, tick.weapon_slug,
        tick.bottom_price, tick.sample_count, tick.active_count || 0, tick.min_price, tick.p5_price, tick.p10_price,
        tick.created_at, tick.source_status, tick.error_code || null,
      )
    );
    return this.db.batch(statements);
  }

  async getTrend(weaponSlug: string, platform: string, startTime: string) {
    const { results } = await d1WithRetry("riven_bottom_tick.getTrend", () =>
      this.db.prepare(`
        SELECT ts, bottom_price, sample_count, active_count, min_price, p5_price, p10_price, source_status 
        FROM riven_bottom_tick
        WHERE weapon_slug = ? AND platform = ? AND ts >= ?
        ORDER BY ts ASC
      `).bind(weaponSlug, platform, startTime).all<Tick>(),
    );
    return results;
  }

  async getLatestTick(weaponSlug: string, platform: string) {
    return d1WithRetry("riven_bottom_tick.getLatestTick", () =>
      this.db.prepare(`
        SELECT ts, bottom_price, sample_count, active_count, min_price, p5_price, p10_price, source_status 
        FROM riven_bottom_tick
        WHERE weapon_slug = ? AND platform = ?
        ORDER BY ts DESC
        LIMIT 1
      `).bind(weaponSlug, platform).first<Tick>(),
    );
  }

  /**
   * 获取 SQL 级别聚合的趋势数据
   * @param interval 'day' | 'hour' | '4hour'
   */
  async getAggregatedTrend(weaponSlug: string, platform: string, startTime: string, interval: 'day' | 'hour' | '4hour') {
    let sqlGroupTs: string;
    if (interval === 'day') {
      sqlGroupTs = "strftime('%Y-%m-%d', ts)";
    } else if (interval === 'hour') {
      sqlGroupTs = "strftime('%Y-%m-%dT%H:00:00Z', ts)";
    } else {
      // 4小时聚合：00, 04, 08, 12, 16, 20
      sqlGroupTs = "strftime('%Y-%m-%dT', ts) || printf('%02d:00:00Z', (CAST(strftime('%H', ts) AS INTEGER) / 4) * 4)";
    }
    
    const { results } = await d1WithRetry("riven_bottom_tick.getAggregatedTrend", () =>
      this.db.prepare(`
        SELECT 
          ${sqlGroupTs} as group_ts,
          AVG(bottom_price) as bottom_price,
          AVG(sample_count) as sample_count,
          AVG(active_count) as active_count,
          MIN(min_price) as min_price,
          AVG(p5_price) as p5_price,
          AVG(p10_price) as p10_price,
          COUNT(*) as aggregated_count
        FROM riven_bottom_tick
        WHERE weapon_slug = ? AND platform = ? AND ts >= ? AND source_status = 'ok'
        GROUP BY group_ts
        ORDER BY group_ts ASC
      `).bind(weaponSlug, platform, startTime).all<any>(),
    );

    return results.map(r => ({
      ts: interval === 'day' ? r.group_ts + 'T00:00:00Z' : r.group_ts,
      bottom_price: Math.round(r.bottom_price),
      sample_count: Math.round(r.sample_count),
      active_count: Math.round(r.active_count),
      min_price: r.min_price,
      p5_price: Math.round(r.p5_price),
      p10_price: Math.round(r.p10_price),
      status: 'ok',
      aggregated_count: r.aggregated_count
    }));
  }

  async getLastTickTime(): Promise<string | null> {
    const res = await d1WithRetry("riven_bottom_tick.getLastTickTime", () =>
      this.db.prepare(`SELECT MAX(ts) as last_ts FROM riven_bottom_tick`).first<{ last_ts: string }>(),
    );
    return res?.last_ts || null;
  }

  /**
   * 获取当前最新热门武器排行（最近采样的数据）
   * 优化：避免因采样频率不同导致排名失真
   */
  async getLatestHotWeapons(limit: number = 10, sortBy: 'active_count' | 'price' = 'price') {
    const orderBy = sortBy === 'price' 
      ? 't.bottom_price DESC, t.active_count DESC' 
      : 't.active_count DESC, t.bottom_price ASC';

    const { results } = await d1WithRetry("riven_bottom_tick.getLatestHotWeapons", () =>
      this.db.prepare(`
        SELECT 
          t.weapon_slug as slug, 
          w.name_en, 
          w.name_zh,
          w.thumb,
          w.weapon_group as "group",
          w.riven_type as "rivenType",
          w.disposition,
          w.req_mr,
          t.active_count,
          t.min_price,
          t.bottom_price,
          t.ts
        FROM (
          SELECT 
            weapon_slug,
            bottom_price,
            active_count,
            min_price,
            ts,
            ROW_NUMBER() OVER (PARTITION BY weapon_slug ORDER BY ts DESC) as rn
          FROM riven_bottom_tick
          WHERE source_status = 'ok' 
            AND ts >= datetime('now', '-24 hours')
            AND active_count >= 10
        ) t
        JOIN riven_weapon_dict w ON t.weapon_slug = w.slug
        WHERE t.rn = 1
        ORDER BY ${orderBy}
        LIMIT ?
      `).bind(limit).all<{
        slug: string;
        name_en: string;
        name_zh: string | null;
        thumb: string;
        group: string;
        rivenType: string;
        disposition: number;
        req_mr: number;
        active_count: number;
        min_price: number;
        bottom_price: number;
        ts: string;
      }>(),
    );
    
    return results;
  }
}


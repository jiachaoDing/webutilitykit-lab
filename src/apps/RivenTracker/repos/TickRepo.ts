import { Tick } from "../domain/types";

export class TickRepo {
  constructor(private db: D1Database) {}

  async upsertTick(tick: Tick) {
    return this.db.prepare(`
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
      tick.created_at, tick.source_status, tick.error_code || null
    ).run();
  }

  async getTrend(weaponSlug: string, platform: string, startTime: string) {
    const { results } = await this.db.prepare(`
      SELECT * FROM riven_bottom_tick
      WHERE weapon_slug = ? AND platform = ? AND ts >= ?
      ORDER BY ts ASC
    `).bind(weaponSlug, platform, startTime).all<Tick>();
    return results;
  }

  async getLatestTick(weaponSlug: string, platform: string) {
    return this.db.prepare(`
      SELECT * FROM riven_bottom_tick
      WHERE weapon_slug = ? AND platform = ?
      ORDER BY ts DESC
      LIMIT 1
    `).bind(weaponSlug, platform).first<Tick>();
  }

  async getLastTickTime(): Promise<string | null> {
    const res = await this.db.prepare(`SELECT MAX(ts) as last_ts FROM riven_bottom_tick`).first<{ last_ts: string }>();
    return res?.last_ts || null;
  }

  /**
   * 获取最近一个采样周期内，按卖家数量排序的热门武器
   */
  async getLatestHotWeapons(limit: number = 10) {
    const lastTs = await this.getLastTickTime();
    if (!lastTs) return [];

    const { results } = await this.db.prepare(`
      SELECT 
        t.weapon_slug as slug, 
        w.name_en, 
        w.name_zh,
        w.thumb,
        w.weapon_group as "group",
        t.active_count,
        t.min_price
      FROM riven_bottom_tick t
      JOIN riven_weapon_dict w ON t.weapon_slug = w.slug
      WHERE t.ts = ? AND t.source_status = 'ok'
      ORDER BY t.active_count DESC, t.min_price ASC
      LIMIT ?
    `).bind(lastTs, limit).all<{
      slug: string;
      name_en: string;
      name_zh: string | null;
      thumb: string;
      group: string;
      active_count: number;
      min_price: number;
    }>();
    
    return results;
  }
}


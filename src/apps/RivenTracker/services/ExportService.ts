import { TickRepo } from "../repos/TickRepo";
import { WeaponRepo } from "../repos/WeaponRepo";

export interface ExportedTicks {
  generated_at: string;             // ISO UTC 时间，导出时刻
  range: '30d';                     // 暂时只做 30d 导出
  interval_minutes: number;         // 30
  platform: 'pc';
  weapons: {
    slug: string;
    name_en: string;
    name_zh: string | null;
    ticks: {
      ts: string;                   // 对齐到 30 分钟的 UTC 时间戳 (window_ts)
      bottom_price: number | null;
      sample_count: number;
      min_price: number | null;
      p5_price: number | null;
      p10_price: number | null;
    }[];
  }[];
}

export class ExportService {
  constructor(private db: D1Database) {}

  /**
   * 导出最近 30 天的趋势数据
   */
  async export30d(): Promise<ExportedTicks> {
    const now = new Date();
    const startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // 1. 一次性查出最近 30 天的所有数据
    // 注意：为了避免大数据量导致内存溢出，我们按武器分组并在 D1 端尽量完成过滤
    const { results } = await this.db.prepare(`
      SELECT 
        t.ts,
        t.weapon_slug,
        t.bottom_price,
        t.sample_count,
        t.min_price,
        t.p5_price,
        t.p10_price,
        w.name_en,
        w.name_zh
      FROM riven_bottom_tick t
      JOIN riven_weapon_dict w ON t.weapon_slug = w.slug
      WHERE t.platform = 'pc' AND t.ts >= ?
      ORDER BY t.weapon_slug ASC, t.ts ASC
    `).bind(startTime).all<any>();

    // 2. 内存中按武器聚合成 JSON
    const weaponsMap = new Map<string, any>();

    for (const row of results) {
      if (!weaponsMap.has(row.weapon_slug)) {
        weaponsMap.set(row.weapon_slug, {
          slug: row.weapon_slug,
          name_en: row.name_en,
          name_zh: row.name_zh,
          ticks: []
        });
      }

      weaponsMap.get(row.weapon_slug).ticks.push({
        ts: row.ts,
        bottom_price: row.bottom_price,
        sample_count: row.sample_count,
        min_price: row.min_price,
        p5_price: row.p5_price,
        p10_price: row.p10_price
      });
    }

    return {
      generated_at: now.toISOString(),
      range: '30d',
      interval_minutes: 30,
      platform: 'pc',
      weapons: Array.from(weaponsMap.values())
    };
  }
}


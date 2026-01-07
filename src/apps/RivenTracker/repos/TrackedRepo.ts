import { d1WithRetry } from "../infra/d1Retry";

export interface TrackedWeapon {
  slug: string;
  enabled: number;
  priority: number;
  tier?: string;
  note?: string;
}

export class TrackedRepo {
  constructor(private db: D1Database) {}

  async getEnabledTracked() {
    const { results } = await d1WithRetry("tracked_weapon.getEnabledTracked", () =>
      this.db.prepare(`
        SELECT * FROM tracked_weapon WHERE enabled = 1 ORDER BY priority DESC
      `).all<TrackedWeapon>(),
    );
    return results;
  }

  /**
   * 获取指定 tier 的已启用武器列表
   * @param tier 'hot' | 'cold'
   */
  async getEnabledByTier(tier: 'hot' | 'cold') {
    const { results } = await d1WithRetry("tracked_weapon.getEnabledByTier", () =>
      this.db.prepare(`
        SELECT * FROM tracked_weapon 
        WHERE enabled = 1 AND tier = ?
        ORDER BY priority DESC, slug ASC
      `).bind(tier).all<TrackedWeapon>(),
    );
    return results;
  }

  /**
   * 更新武器的 tier
   */
  async updateTier(slug: string, tier: 'hot' | 'cold') {
    return d1WithRetry("tracked_weapon.updateTier", () =>
      this.db.prepare(`
        UPDATE tracked_weapon SET tier = ? WHERE slug = ?
      `).bind(tier, slug).run(),
    );
  }

  /**
   * 批量更新武器的 tier
   */
  async batchUpdateTiers(updates: { slug: string; tier: 'hot' | 'cold' }[]) {
    const statements = updates.map(({ slug, tier }) =>
      this.db.prepare(`UPDATE tracked_weapon SET tier = ? WHERE slug = ?`).bind(tier, slug)
    );
    
    // D1 batch 有参数数量限制，每批最多 20 条（避免 "too many SQL variables" 错误）
    for (let i = 0; i < statements.length; i += 20) {
      await this.db.batch(statements.slice(i, i + 20));
    }
  }

  async addTracked(slug: string, priority: number = 0) {
    return d1WithRetry("tracked_weapon.addTracked", () =>
      this.db.prepare(`
        INSERT INTO tracked_weapon (slug, enabled, priority)
        VALUES (?, 1, ?)
        ON CONFLICT(slug) DO UPDATE SET enabled = 1, priority = excluded.priority
      `).bind(slug, priority).run(),
    );
  }

  async countEnabled(): Promise<number> {
    const res = await d1WithRetry("tracked_weapon.countEnabled", () =>
      this.db
        .prepare(`SELECT COUNT(*) as count FROM tracked_weapon WHERE enabled = 1`)
        .first<{ count: number }>(),
    );
    return res?.count || 0;
  }

  /**
   * 获取各 tier 的武器数量统计
   */
  async getTierStats(): Promise<{ hot: number; cold: number }> {
    const { results } = await d1WithRetry("tracked_weapon.getTierStats", () =>
      this.db.prepare(`
        SELECT tier, COUNT(*) as count 
        FROM tracked_weapon 
        WHERE enabled = 1 
        GROUP BY tier
      `).all<{ tier: string; count: number }>(),
    );
    
    const stats = { hot: 0, cold: 0 };
    results.forEach(r => {
      if (r.tier === 'hot') stats.hot = r.count;
      else if (r.tier === 'cold') stats.cold = r.count;
    });
    return stats;
  }
}


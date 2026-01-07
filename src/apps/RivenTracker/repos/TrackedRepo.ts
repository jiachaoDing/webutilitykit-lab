export interface TrackedWeapon {
  slug: string;
  enabled: number;
  priority: number;
  note?: string;
}

export class TrackedRepo {
  constructor(private db: D1Database) {}

  async getEnabledTracked() {
    const { results } = await this.db.prepare(`
      SELECT * FROM tracked_weapon WHERE enabled = 1 ORDER BY priority DESC
    `).all<TrackedWeapon>();
    return results;
  }

  async addTracked(slug: string, priority: number = 0) {
    return this.db.prepare(`
      INSERT INTO tracked_weapon (slug, enabled, priority)
      VALUES (?, 1, ?)
      ON CONFLICT(slug) DO UPDATE SET enabled = 1, priority = excluded.priority
    `).bind(slug, priority).run();
  }

  async countEnabled(): Promise<number> {
    const res = await this.db.prepare(`SELECT COUNT(*) as count FROM tracked_weapon WHERE enabled = 1`).first<{ count: number }>();
    return res?.count || 0;
  }
}


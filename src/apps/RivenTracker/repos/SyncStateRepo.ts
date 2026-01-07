export class SyncStateRepo {
  constructor(private db: D1Database) {}

  async get(key: string): Promise<string | null> {
    const res = await this.db.prepare(`SELECT value FROM sync_state WHERE key = ?`).bind(key).first<{ value: string }>();
    return res?.value || null;
  }

  async set(key: string, value: string) {
    const now = new Date().toISOString();
    return this.db.prepare(`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(key, value, now).run();
  }
}


import { RivenWeapon } from "../domain/types";

export class WeaponRepo {
  constructor(private db: D1Database) {}

  async upsertMany(weapons: RivenWeapon[]) {
    const now = new Date().toISOString();
    const statements = weapons.map(w => 
      this.db.prepare(`
        INSERT INTO riven_weapon_dict (slug, name_en, name_zh, icon, thumb, weapon_group, riven_type, disposition, req_mr, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          name_en = excluded.name_en,
          name_zh = excluded.name_zh,
          icon = excluded.icon,
          thumb = excluded.thumb,
          weapon_group = excluded.weapon_group,
          riven_type = excluded.riven_type,
          disposition = excluded.disposition,
          req_mr = excluded.req_mr,
          updated_at = excluded.updated_at
      `).bind(w.slug, w.name_en, w.name_zh, w.icon, w.thumb, w.group, w.rivenType, w.disposition, w.req_mr, now)
    );
    // D1 batch 有上限，通常分批处理
    for (let i = 0; i < statements.length; i += 50) {
      await this.db.batch(statements.slice(i, i + 50));
    }
  }

  async search(query: string, limit: number = 20) {
    const { results } = await this.db.prepare(`
      SELECT 
        slug, 
        name_en, 
        name_zh,
        icon, 
        thumb, 
        weapon_group as "group", 
        riven_type as "rivenType", 
        disposition, 
        req_mr 
      FROM riven_weapon_dict
      WHERE name_en LIKE ? OR name_zh LIKE ? OR slug LIKE ?
      LIMIT ?
    `).bind(`%${query}%`, `%${query}%`, `%${query}%`, limit).all<RivenWeapon>();
    return results;
  }

  async getAllSlugs(): Promise<string[]> {
    const { results } = await this.db.prepare(`SELECT slug FROM riven_weapon_dict`).all<{ slug: string }>();
    return results.map(r => r.slug);
  }
}


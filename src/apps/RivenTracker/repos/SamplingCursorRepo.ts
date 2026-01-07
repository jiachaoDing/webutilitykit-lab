import { d1WithRetry } from "../infra/d1Retry";

export interface SamplingCursorState {
  cursor: number;
  updatedAt: string;
}

export interface TieredCursorState {
  cursorHot: number;
  cursorCold: number;
  updatedAt: string;
}

/**
 * 采样游标：把"每分钟采样哪一批武器"的进度存到 D1（sync_state 表）里。
 * 这样即使某次 cron 超时/失败，也不会导致某些武器长期轮不到（例如执法者 magistar）。
 * 
 * v2 支持分层游标：
 * - cursorHot: 热门武器（tier='hot'）的游标
 * - cursorCold: 冷门武器（tier='cold'）的游标
 */
export class SamplingCursorRepo {
  private readonly keyLegacy = "sampling_cursor_v1";
  private readonly keyTiered = "sampling_cursor_v2_tiered";

  constructor(private db: D1Database) {}

  /**
   * 获取分层游标（v2）
   */
  async getTiered(): Promise<TieredCursorState | null> {
    const res = await d1WithRetry("sampling_cursor.getTiered", () =>
      this.db
        .prepare(`SELECT value, updated_at FROM sync_state WHERE key = ?`)
        .bind(this.keyTiered)
        .first<{ value: string; updated_at: string }>(),
    );

    if (!res?.value) return null;

    try {
      const parsed = JSON.parse(res.value) as { cursorHot?: number; cursorCold?: number };
      if (typeof parsed.cursorHot !== "number" || typeof parsed.cursorCold !== "number") return null;
      return {
        cursorHot: parsed.cursorHot,
        cursorCold: parsed.cursorCold,
        updatedAt: res.updated_at,
      };
    } catch {
      return null;
    }
  }

  /**
   * 设置分层游标（v2）
   */
  async setTiered(cursorHot: number, cursorCold: number) {
    const now = new Date().toISOString();
    const value = JSON.stringify({ cursorHot, cursorCold });
    return d1WithRetry("sampling_cursor.setTiered", () =>
      this.db
        .prepare(
          `
        INSERT INTO sync_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
        )
        .bind(this.keyTiered, value, now)
        .run(),
    );
  }

  // ========== Legacy 单游标接口（兼容旧代码）==========

  async get(): Promise<SamplingCursorState | null> {
    const res = await d1WithRetry("sampling_cursor.get", () =>
      this.db
        .prepare(`SELECT value, updated_at FROM sync_state WHERE key = ?`)
        .bind(this.keyLegacy)
        .first<{ value: string; updated_at: string }>(),
    );

    if (!res?.value) return null;

    try {
      // 兼容历史格式：
      // - v0: { windowTs: string, cursor: number }
      // - v1: { cursor: number }
      const parsed = JSON.parse(res.value) as { windowTs?: string; cursor?: number };
      if (typeof parsed.cursor !== "number") return null;
      return {
        cursor: parsed.cursor,
        updatedAt: res.updated_at,
      };
    } catch {
      return null;
    }
  }

  async set(cursor: number) {
    const now = new Date().toISOString();
    const value = JSON.stringify({ cursor });
    return d1WithRetry("sampling_cursor.set", () =>
      this.db
        .prepare(
          `
        INSERT INTO sync_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
        )
        .bind(this.keyLegacy, value, now)
        .run(),
    );
  }
}



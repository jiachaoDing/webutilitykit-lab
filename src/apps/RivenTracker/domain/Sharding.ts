export class Sharding {
  /**
   * 分片数量：30 分钟一个窗口 -> 每分钟跑一个分片，30 分钟覆盖全部
   */
  static readonly SHARD_COUNT = 30;

  /**
   * 使用简单的 DJB2 算法对 slug 进行哈希，保证稳定性。
   */
  static hashSlug(slug: string): number {
    let hash = 5381;
    for (let i = 0; i < slug.length; i++) {
      hash = (hash * 33) ^ slug.charCodeAt(i);
    }
    return Math.abs(hash);
  }

  /**
   * 兼容保留：基于 hash 的分片（不再用于采样分配，仅供历史/调试）
   */
  static getShard(slug: string): number {
    return this.hashSlug(slug) % this.SHARD_COUNT;
  }

  /**
   * 根据当前分钟数映射到分片索引 (每 1 分钟一个分片，循环 30 分钟)
   */
  static getShardFromMinute(minute: number): number {
    return minute % this.SHARD_COUNT;
  }

  /**
   * 计算对齐到 1 分钟窗口的 ISO 时间戳
   * 优化：使用 1 分钟窗口，避免分层采样时数据覆盖
   * （原 30 分钟窗口会导致热门武器在同一窗口内多次采样互相覆盖）
   */
  static getWindowTs(now: Date): string {
    const ts = new Date(now);
    ts.setUTCSeconds(0);
    ts.setUTCMilliseconds(0);
    // 对齐到当前分钟（保留分钟数，秒和毫秒归零）
    return ts.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
}


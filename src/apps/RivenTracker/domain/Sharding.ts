export class Sharding {
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
   * 根据武器 slug 计算所属分片 (0..5)
   */
  static getShard(slug: string): number {
    return this.hashSlug(slug) % 6;
  }

  /**
   * 根据当前分钟数映射到分片索引 (每 5 分钟一个分片)
   */
  static getShardFromMinute(minute: number): number {
    return Math.floor((minute % 30) / 5);
  }

  /**
   * 计算对齐到 30 分钟窗口的 ISO 时间戳 (00 或 30 分)
   */
  static getWindowTs(now: Date): string {
    const ts = new Date(now);
    ts.setUTCSeconds(0);
    ts.setUTCMilliseconds(0);
    const minutes = ts.getUTCMinutes();
    ts.setUTCMinutes(minutes < 30 ? 0 : 30);
    return ts.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
}


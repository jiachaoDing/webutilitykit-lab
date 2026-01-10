import { Tick, RivenWeapon } from "./domain/types";
import { TickRepo } from "./repos/TickRepo";
import { TrackedRepo } from "./repos/TrackedRepo";
import { WeaponRepo } from "./repos/WeaponRepo";

interface DOEnv {
  DB: D1Database;
  KV: KVNamespace;
}

/**
 * RivenCoordinatorDO
 * 唯一负责：
 * 1. 维护采样游标 (cursorHot/cursorCold)
 * 2. 维护已启用的武器名单 (listHot/listCold)
 * 3. 批量写入 D1 历史表
 * 4. 维护最新价格快照并通过 KV 同步
 */
export class RivenCoordinatorDO implements DurableObject {
  // 游标与武器列表
  private cursorHot: number = 0;
  private cursorCold: number = 0;
  private listHot: string[] = [];
  private listCold: string[] = [];
  
  // 内存缓存：武器元数据 (几乎静态)
  private weaponMetadata: Map<string, RivenWeapon> = new Map();
  
  // 最新快照 (latestBySlug)
  private latestBySlug: Record<string, Tick> = {};

  // 近期历史缓存 (recentHistory): Map<slug, Tick[]>
  // 仅保留最近 100 条记录（约 1 小时的分钟级数据，或更长时间的分层数据）
  private recentHistory: Map<string, Tick[]> = new Map();
  
  // 状态标记
  private dirty: boolean = false;
  private initialized: boolean = false;

  constructor(private state: DurableObjectState, private env: DOEnv) {
    // 启动时从持久化存储加载状态
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<any>([
        "cursorHot",
        "cursorCold",
        "listHot",
        "listCold",
        "latestBySlug",
        "dirty"
      ]);

      this.cursorHot = stored.get("cursorHot") || 0;
      this.cursorCold = stored.get("cursorCold") || 0;
      this.listHot = stored.get("listHot") || [];
      this.listCold = stored.get("listCold") || [];
      this.latestBySlug = stored.get("latestBySlug") || {};
      this.dirty = stored.get("dirty") || false;

      // 启动时刷新名单和元数据
      await this.refreshLists();
      
      this.initialized = true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case "/next-batch":
          return await this.handleNextBatch(request);
        case "/append-results":
          return await this.handleAppendResults(request);
        case "/sync-snapshot":
          return await this.handleSyncSnapshot();
        case "/refresh-lists":
          return await this.handleRefreshLists();
        case "/latest":
          return await this.handleGetLatest(url);
        case "/recent-history":
          return await this.handleGetRecentHistory(url);
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (e: any) {
      console.error(`[DO Error] ${e.message}`, e.stack);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * 计算并返回下一批要采样的武器
   * GET /next-batch?hotBatchSize=5&coldBatchSize=0
   */
  private async handleNextBatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const hotBatchSize = parseInt(url.searchParams.get("hotBatchSize") || "0");
    const coldBatchSize = parseInt(url.searchParams.get("coldBatchSize") || "0");

    const totalHot = this.listHot.length;
    const totalCold = this.listCold.length;

    const slugs: string[] = [];

    // 选取热门武器
    if (totalHot > 0 && hotBatchSize > 0) {
      for (let i = 0; i < hotBatchSize; i++) {
        const idx = (this.cursorHot + i) % totalHot;
        slugs.push(this.listHot[idx]);
      }
      this.cursorHot = (this.cursorHot + hotBatchSize) % totalHot;
    }

    // 选取冷门武器
    if (totalCold > 0 && coldBatchSize > 0) {
      for (let i = 0; i < coldBatchSize; i++) {
        const idx = (this.cursorCold + i) % totalCold;
        slugs.push(this.listCold[idx]);
      }
      this.cursorCold = (this.cursorCold + coldBatchSize) % totalCold;
    }

    // 持久化游标
    await this.state.storage.put({
      cursorHot: this.cursorHot,
      cursorCold: this.cursorCold
    });

    return new Response(JSON.stringify({ slugs }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 接收采样结果并写入 D1，更新内存快照
   * POST /append-results
   */
  private async handleAppendResults(request: Request): Promise<Response> {
    const data: { ts: string; samples: Tick[] } = await request.json();
    const { samples } = data;

    if (!samples || samples.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0 }));
    }

    // 1. 批量写入 D1 (历史真相库)
    const tickRepo = new TickRepo(this.env.DB);
    await tickRepo.batchUpsertTicks(samples);

    // 2. 更新内存快照 (latestBySlug) 与近期历史 (recentHistory)
    for (const sample of samples) {
      if (sample.source_status === 'ok' && sample.bottom_price !== null) {
        this.latestBySlug[sample.weapon_slug] = sample;

        // 更新近期历史队列
        let history = this.recentHistory.get(sample.weapon_slug) || [];
        history.push(sample);
        // 限制长度，例如保留最近 100 条 (如果是热门武器，大约能覆盖 1-2 小时)
        if (history.length > 100) {
          history.shift();
        }
        this.recentHistory.set(sample.weapon_slug, history);
      }
    }

    this.dirty = true;

    // 3. 持久化最新状态
    await this.state.storage.put({
      latestBySlug: this.latestBySlug,
      dirty: this.dirty
    });

    return new Response(JSON.stringify({ success: true, count: samples.length }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 将内存中的最新快照合并写入 KV
   * POST /sync-snapshot
   */
  private async handleSyncSnapshot(): Promise<Response> {
    if (!this.dirty) {
      return new Response(JSON.stringify({ success: true, message: "not dirty" }));
    }

    // 1. 写入全量快照 (riven:latest:pc)
    await this.env.KV.put("riven:latest:pc", JSON.stringify(this.latestBySlug), {
      expirationTtl: 3600 
    });

    // 2. 预计算 Top 50 热门武器榜单 (按价格)
    try {
      const allLatest = Object.values(this.latestBySlug);
      // 过滤：状态正常 且 活跃卖家 >= 10 (保证价格真实性)
      const topTicks = (allLatest
        .filter(t => t.source_status === 'ok' && t.active_count >= 10 && t.bottom_price !== null && t.bottom_price > 0) as (Tick & { bottom_price: number })[])
        .sort((a, b) => b.bottom_price - a.bottom_price)
        .slice(0, 50);

      if (topTicks.length > 0) {
        const hotlist = topTicks.map(t => {
          // 直接从内存 Map 中读取元数据，不再查询数据库
          const w = this.weaponMetadata.get(t.weapon_slug);
          if (!w) return null;
          return {
            slug: t.weapon_slug,
            name_en: w.name_en,
            name_zh: w.name_zh,
            thumb: w.thumb,
            group: w.group,
            rivenType: w.rivenType,
            disposition: w.disposition,
            req_mr: w.req_mr,
            active_count: t.active_count,
            min_price: t.min_price,
            bottom_price: t.bottom_price,
            ts: t.ts
          };
        }).filter(item => item !== null);

        // 存入专用的热门榜单键，有效期与采样周期匹配
        await this.env.KV.put("riven:hotlist:price:top50", JSON.stringify({
          data: hotlist,
          updated_at: new Date().toISOString(),
          source: 'do_precomputed'
        }), {
          expirationTtl: 1800 // 30 分钟过期
        });
      }
    } catch (e) {
      console.error("[DO] Precompute hotlist failed:", e);
    }

    this.dirty = false;
    await this.state.storage.put("dirty", false);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 刷新武器名单（当后台修改了武器配置时调用）
   * POST /refresh-lists
   */
  private async handleRefreshLists(): Promise<Response> {
    await this.refreshLists();
    return new Response(JSON.stringify({ 
      success: true, 
      hotCount: this.listHot.length, 
      coldCount: this.listCold.length 
    }));
  }

  /**
   * 获取实时快照 (可选接口，用于直接读 DO)
   */
  private async handleGetLatest(url: URL): Promise<Response> {
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return new Response(JSON.stringify(this.latestBySlug), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const tick = this.latestBySlug[slug];
    return new Response(JSON.stringify(tick || null), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 获取近期历史趋势 (从内存读取，若无则从 D1 加载)
   */
  private async handleGetRecentHistory(url: URL): Promise<Response> {
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return new Response("slug is required", { status: 400 });
    }
    
    let history = this.recentHistory.get(slug);
    
    // 如果内存中没有（可能是 DO 刚重启），从 D1 加载最近 100 条
    if (!history || history.length === 0) {
      const tickRepo = new TickRepo(this.env.DB);
      history = await tickRepo.getRecentTicks(slug, 'pc', 100);
      this.recentHistory.set(slug, history);
    }
    
    return new Response(JSON.stringify(history), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 从数据库/KV刷新武器名单缓存
   */
  private async refreshLists() {
    const trackedRepo = new TrackedRepo(this.env.DB);
    const weaponRepo = new WeaponRepo(this.env.DB);
    
    // 1. 同时刷新启用的名单和完整的武器元数据
    const [hotList, coldList, allWeapons] = await Promise.all([
      trackedRepo.getEnabledByTier('hot'),
      trackedRepo.getEnabledByTier('cold'),
      weaponRepo.getAllWeapons()
    ]);

    // 2. 更新名单
    this.listHot = hotList.map(w => w.slug);
    this.listCold = coldList.map(w => w.slug);

    // 3. 更新内存中的元数据缓存 (解决“每次同步都要查数据库”的问题)
    this.weaponMetadata.clear();
    for (const w of allWeapons) {
      this.weaponMetadata.set(w.slug, w);
    }

    // 游标边界检查
    if (this.cursorHot >= this.listHot.length) this.cursorHot = 0;
    if (this.cursorCold >= this.listCold.length) this.cursorCold = 0;

    await this.state.storage.put({
      listHot: this.listHot,
      listCold: this.listCold,
      cursorHot: this.cursorHot,
      cursorCold: this.cursorCold
    });

    // 同时同步到 KV，供前端或管理端低频查询
    await Promise.all([
      this.env.KV.put("riven:list:hot", JSON.stringify(this.listHot)),
      this.env.KV.put("riven:list:cold", JSON.stringify(this.listCold)),
    ]);
  }
}


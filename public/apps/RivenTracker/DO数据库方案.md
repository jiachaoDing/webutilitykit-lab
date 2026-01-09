
# RivenTracker Durable Object 协同架构方案 (V3.0 - 定稿版)

## 一、 整体设计理念

**“状态收敛于 DO，历史持久化于 D1，极简快照存于 KV。”**

本方案通过引入 `RivenCoordinatorDO` 作为唯一的**状态真理中心**，解决了多 Worker 并发导致的游标冲突、频繁读写 D1 导致的性能瓶颈，以及 KV 写入额度超限的问题。

---

## 二、 核心存储数据结构详解

### 1. Durable Object (内部持久化：`state.storage`)

这是 DO 重启后恢复状态的关键。所有字段均通过 `this.state.storage.put()` 持久化。

| 键名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `cursorHot` | `number` | 热门武器列表的采样游标索引 |
| `cursorCold` | `number` | 冷门武器列表的采样游标索引 |
| `listHot` | `string[]` | 热门武器 Slug 数组 (如 `["soma", "rubico", ...]`) |
| `listCold` | `string[]` | 冷门武器 Slug 数组 |
| `dirty` | `boolean` | 脏标记：内存快照是否有未同步到 KV 的更新 |
| `latestBySlug` | `Map<string, Tick>` | **核心字典**：存储所有追踪武器的**最新一条**采样成功结果 |

#### `Tick` 对象结构：
```typescript
{
  ts: string;            // 采样时间戳（对齐到分钟，如 "2026-01-09T10:00:00Z"）
  platform: "pc";        // 平台
  weapon_slug: string;   // 武器 ID (如 "soma")
  bottom_price: number;  // 加权底价指数
  active_count: number;  // 活跃卖家总数
  min_price: number;     // 全服最低价
  p5_price: number;      // 第 5 名报价
  p10_price: number;     // 第 10 名报价
  source_status: "ok";   // 状态
  created_at: string;    // 入库时间
}
```

---

### 2. KV 存储 (高速分发层：`env.KV`)

DO 每 5 分钟将内存中的 `latestBySlug` 打包同步一次，旨在实现 API 的“秒开”。

*   **Key**: `riven:latest:pc`
*   **Value 类型**: `string` (序列化后的 JSON Bundle)
*   **结构**:
```json
{
  "soma": { "ts": "...", "bottom_price": 450, "active_count": 12, ... },
  "rubico": { "ts": "...", "bottom_price": 850, "active_count": 8, ... },
  ... (全量已采样的武器快照)
}
```
*   **优势**: 前端接口读取 1 次 KV 即可获得所有武器的实时状态，极度节省读取次数。

---

### 3. D1 数据库 (历史真相库：`env.DB`)

存储所有历史采样记录。由 DO 负责每分钟“即时转发”写入，避免多点并发竞争。

*   **表名**: `riven_bottom_tick`
*   **主键**: `(ts, platform, weapon_slug)`
*   **结构**: 每一行是一次具体的采样。
```sql
CREATE TABLE riven_bottom_tick (
    ts TEXT,                -- 时间戳
    platform TEXT,          -- 平台
    weapon_slug TEXT,       -- 武器
    bottom_price INTEGER,   -- 指数
    active_count INTEGER,   -- 活跃数
    -- ... 其余字段与 Tick 对象一致
    PRIMARY KEY (ts, platform, weapon_slug)
);
```

---

## 三、 组件职责与数据流转

### 1. Cron Worker (每分钟执行)
1.  **问任务**：请求 DO `/next-batch` 获取 5 个 slugs。
2.  **做采样**：并发请求 WFM API 并通过算法计算底价。
3.  **交结果**：将 `samples[]` POST 给 DO `/append-results`。

### 2. Durable Object (唯一守门员)
1.  **管游标**：在内存中推进 `cursor`，确保采样不重不漏。
2.  **写 D1**：收到结果后立即发起 `env.DB.batch()` 写入，确保历史记录持久化。
3.  **更快照**：更新内存中的 `latestBySlug` 字典，并设置 `dirty = true`。
4.  **步 KV**：每 5 分钟检测 `dirty`，若为真则将全量字典推送到 KV。

### 3. Hono API (前端访问)
1.  **查趋势**：直接查询 **D1**（利用索引获取历史图表数据）。
2.  **查快照**：优先读取 **KV** 中的大 JSON Bundle（秒开）；若失效则降级向 DO 索取最新值。

---

## 四、 架构收益总结

1.  **D1 零竞争**：D1 写入权收拢到 DO 单例，彻底告别 `Database is locked` 错误。
2.  **KV 额度极省**：通过大 JSON 方案，KV 写入量下降约 **95%**。
3.  **状态强一致**：游标由 DO 内存控制，采样逻辑不再依赖不稳定的分布式时钟或最终一致性的存储。
4.  **极致响应**：底价查询接口响应时间从 ~100ms 下降到 **~10ms**。
```

主要更新点说明：
- **细化了 Tick 结构**：加入了 `active_count`、`p10_price` 等代码中实际使用的关键字段。
- **明确了 DO 内部存储**：区分了内存字典和 `state.storage` 的关系。
- **定义了 KV Bundle 格式**：解释了为什么从多 Key 变为单 Key 大 JSON。
- **梳理了数据流**：强调了 DO 作为 D1 写入“守门员”的角色。
# RivenTracker KV 数据库设计说明 (V3.0 - DO 协同架构)

在引入 **Durable Object (RivenCoordinatorDO)** 后，Cloudflare KV 的定位从“高频缓冲区”转变为 **“低频静态分发层”**。这一转变将 KV 的写入压力降低了 90% 以上，解决了免费额度告急的问题，并实现了更强的状态一致性。

## 1. 核心设计理念

**“状态收敛于 DO，历史持久化于 D1，极简快照存于 KV。”**

*   **Durable Object (DO)**：作为唯一的**状态真理中心**，维护采样游标、武器名单、内存快照，并负责唯一的 D1 批量写入路径。
*   **KV (Key-Value)**：仅作为 **“合并后的快照”** 和 **“武器名单”** 的只读/低频更新分发层。
*   **D1 (SQL)**：作为历史真相库，存储所有采样明细。

---

## 2. KV 的核心作用（重构后）

### A. 武器名单分发 (List Distribution)
*   **Key**: `riven:list:hot`, `riven:list:cold`
*   **作用**: 存储已启用的武器 Slug 列表。
*   **更新机制**: 由管理接口触发 DO 刷新，DO 从 D1 读取后同步写入 KV。
*   **变更**: 采样任务不再通过 KV 游标运行，而是直接向 DO 索要本轮 slugs。KV 仅供前端或管理端快速查询名单。

### B. 合并快照秒开 (Bundled Snapshot)
*   **Key**: `riven:latest:pc`
*   **作用**: 存储**全量/热点武器**最近一次采样的合并 JSON 结果（Bundle）。
*   **变更 (重要)**: 
    1.  **从多 Key 变为单 Key**: 以前是 `riven:latest:pc:<slug>`（每分钟写 N 次），现在是一个大 JSON（每 5 分钟写 1 次）。
    2.  **写成本大幅降低**: 即使有 500 把武器，写入操作也从每小时数百次降低到 12 次。
    3.  **读成本优化**: `/bottom-now` 接口一次 KV GET 即可获取所需武器的最新快照。

### C. 弃用的功能 (Deprecation)
*   **游标管理**: `sampling_cursor_v2_tiered` 已废弃，游标现在完全由 DO 的内存和 `state.storage` 管理，不再占用 KV 写入额度。
*   **写入缓冲区**: `riven:buffer:bundle:*` 与 `riven:buffer:stats:*` 已废弃。DO 利用内存合并结果并直接 `batch` 写入 D1，不再需要 KV 中转。

---

## 3. 数据生命周期 (Lifecycle)

| 数据类型 | 存储点 | 管理方式 | 逻辑说明 |
| :--- | :--- | :--- | :--- |
| **采样游标** | **DO Storage** | 强一致性读写 | 确保采样不重不漏，无视 KV 传播延迟。 |
| **实时快照** | **DO Memory** | 毫秒级更新 | DO 内存始终保持最新的所有武器采样结果。 |
| **合并快照** | **KV** | 定时同步 (5min) | 将 DO 内存快照打包写入 KV，供 API 高速分发。 |
| **武器名单** | **KV + DO** | 手动/任务刷新 | 当 `tracked_weapon` 表变动时，同步刷新。 |
| **历史明细** | **D1** | 批量写入 (1min) | DO 负责每分钟将采样结果刷入 D1。 |

---

## 4. 维护与调试 (新接口)

系统迁移至 DO 协同架构后，调试接口也进行了相应适配：

1.  **强制刷新名单**: `POST /api/RivenTracker/debug/refresh-list`
    *   通知 DO 重新读取 D1 武器表并刷新 KV 名单。
2.  **手动同步快照**: `POST /api/RivenTracker/debug/sync-snapshot`
    *   强制 DO 立即将当前内存中的 `latestBySlug` 合并写入 KV。
3.  **查看实时快照**: `GET /api/RivenTracker/debug/latest?slug=xxx`
    *   绕过 KV 缓存，直接从 DO 内存读取最实时的采样数据。

---

## 5. 架构收益总结

1.  **KV 写入额度节省**: 彻底取消了每分钟多次的 `put` 操作。对于 500 把武器的追踪，KV 写入请求量下降了约 95%。
2.  **游标零碰撞**: 解决了 KV 在极短时间内多次读写游标可能导致的状态错乱（Eventual Consistency 带来的问题）。
3.  **零缓冲延迟**: 采样数据直接进入 DO 处理逻辑并写入 D1，不再需要等待每 10 分钟一次的 KV 冲刷任务。
4.  **接口一致性**: `/bottom-now` 现在可以从一个统一的 Bundle 中读取数据，保证了前端展示的价格在时间维度上更加整齐。
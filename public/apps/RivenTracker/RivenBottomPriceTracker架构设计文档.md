# Riven Bottom Price Tracker 架构设计文档 (V3.0 - DO 协同版)

## 1. 背景与目标

### 1.1 背景

Warframe 紫卡（Riven）底价波动迅速。本系统旨在提供 **In-Game 卖家** 的底价指数与趋势。通过引入 **Durable Object (DO)** 架构，实现了高频、低延迟、且对数据库（D1）写压力极小的采样方案。

### 1.2 产品目标

*   **平台**：仅针对 PC 平台 (`platform=pc`)。
*   **状态**：仅统计在线玩家 (`owner.status == "ingame"`)。
*   **采样频率**：**每 1 分钟** 触发一次采样任务。
*   **分层策略**：热门武器约 20 分钟轮询一次，冷门武器约 1.2 小时轮询一次。
*   **对外 API**：提供武器搜索、趋势查询、**秒开级当前底价快照**。

---

## 2. 技术栈与约束

### 2.1 技术栈

*   **运行环境**：Cloudflare Workers (Standard Service)
*   **状态协调器**：**Cloudflare Durable Objects (DO)**
*   **Web 框架**：Hono
*   **数据库**：Cloudflare D1 (SQLite)
*   **缓存层**：Cloudflare KV (用于大 JSON 快照分发)
*   **定时任务**：Cron Triggers (每分钟触发)

### 2.2 关键约束

*   **KV 写入额度**：必须显著减少 KV 写入。通过 DO 内存合并快照，将写入频率从“每分钟多次”降至“5 分钟一次”。
*   **D1 写锁避免**：所有历史数据写入由 DO 统一排队执行，避免多 Worker 并发写入导致 D1 锁定。
*   **单点状态**：游标（Cursor）完全存储在 DO 内部，确保护采样过程不重不漏。

---

## 3. 系统总体架构 (V3.0)

### 3.1 核心组件

1.  **RivenCoordinatorDO (Durable Object)**
    *   **职责**：状态真理中心。维护游标、武器名单、实时内存快照。
    *   **接口**：`/next-batch` (任务分发), `/append-results` (结果收集与 D1 写入), `/sync-snapshot` (同步 KV)。
2.  **Cron Worker (Sampling Job)**
    *   **职责**：无状态搬运工。每分钟启动，向 DO 领任务，去 WFM 爬数据，将结果交还给 DO。
3.  **D1 数据库**
    *   **职责**：历史真相库。存储 `riven_bottom_tick` 序列和 `job_run` 审计日志。
4.  **KV 存储**
    *   **职责**：高性能快照分发。存储 `riven:latest:pc`（包含所有武器最新底价的大 JSON）。

### 3.2 数据流 (采样路径)

1.  **触发**：Cron 每分钟调用 Worker。
2.  **调度**：Worker 向 DO 获取本轮要采样的 5 个武器 slugs（DO 自动处理 Hot/Cold 游标）。
3.  **采样**：Worker 并发爬取 WFM API，通过 `BottomPriceCalculator` 计算底价。
4.  **汇报**：Worker 将 Ticks 数组提交给 DO。
5.  **落库**：DO 批量 `batch` 写入 D1，并更新内存中的实时快照。
6.  **同步**：DO 每 5 分钟将内存快照全量持久化到 KV 供前端读取。

---

## 4. 采样算法规范

### 4.1 加权底价算法
*   **过滤**：`visible && !closed && owner.status == "ingame" && buyout_price != null`。
*   **剔除异常**：若样本数 $\ge 3$ 且 $p_1 < 0.6 \times \text{mean}(p_2, p_3)$，则剔除 $p_1$。
*   **权重向量**：前 5 个价格权重为 `[0.40, 0.25, 0.15, 0.12, 0.08]`（不足 5 个时归一化）。

---

## 5. 采样调度设计 (DO 驱动)

### 5.1 分层采样规则
*   **热门武器 (Hot)**：50 把，采样权重高。
*   **冷门武器 (Cold)**：350+ 把，采样权重低。
*   **奇偶分钟映射**：
    *   奇数分钟：采样 5 把热门。
    *   偶数分钟：采样 5 把冷门。
    *   *注：具体比例由环境变量 `HOT_BATCH_SIZE_ODD` 等动态控制。*

### 5.2 游标管理
*   不再使用 D1 或 KV 单独存储游标，而是利用 DO 的 `state.storage` 持久化 `cursorHot` 和 `cursorCold`，确保即使 Worker 重启，采样位置也能连续。

---

## 6. 查询与性能策略

### 6.1 当前底价 (/bottom-now)
*   **首选路径**：读取 KV `riven:latest:pc`。这是一个经过压缩的大 JSON，Worker 获取后通过 O(1) 查找直接返回。
*   **降级路径**：若 KV 缺失，回退查询 D1 历史表 `ORDER BY ts DESC LIMIT 1`。

### 6.2 历史趋势 (/bottom-trend)
*   直接查询 D1 索引 `idx_tick(weapon_slug, platform, ts)`，按时间范围返回数据。

---

## 7. 交付清单 (V3.0)

1.  **Durable Object 模块**：实现 `RivenCoordinatorDO` 及其三类 HTTP 接口。
2.  **Cron Job 适配**：重构 `handleScheduled` 以适配 DO 任务分发模式。
3.  **采样算法重构**：精简 `SamplingService`，使其专注于 API 调用与算法计算。
4.  **KV 快照逻辑**：实现从内存快照到 KV 大 JSON Bundle 的周期性同步。
5.  **D1 写操作收敛**：确保所有 `TickRepo` 的写操作均由 DO 实例触发。
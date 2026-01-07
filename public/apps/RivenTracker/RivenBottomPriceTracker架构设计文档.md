# Riven Bottom Price Tracker 架构设计文档（Hono + Cloudflare Workers）

## 1. 背景与目标

### 1.1 背景

Warframe 紫卡（Riven）拍卖价格波动大，交易者决策高度集中在“底部价格区间”。现有平台提供实时列表，但难以直观看到**底价随时间的趋势**。本系统提供**In-Game 卖家**的底价指数与趋势，辅助交易决策。

### 1.2 产品目标（MVP）

* 仅针对 **PC 平台**（`platform=pc`）
* 仅统计 **In-Game（owner.status == "ingame"）**
* 每 **30 分钟**采样一次
* 每个武器生成一个“底价指数 tick”（基于 buyout 前 5 加权）
* 对外提供 Web API：武器搜索、趋势查询、当前底价

### 1.3 非目标

* 不提供交易撮合，不展示完整拍卖列表（避免“镜像站”风险）
* 不做价格预测、复杂估值（词条/极性/洗卡次数分桶暂不做）
* 不追求秒级实时

---

## 2. 技术栈与约束

### 2.1 技术栈

* 运行环境：Cloudflare Workers
* Web 框架：Hono
* 数据库：Cloudflare D1（SQLite）
* 定时任务：Cron Triggers（Workers）
* 缓存与锁（可选）：Cloudflare KV

### 2.2 关键约束

* 外部依赖 API 不保证长期稳定（需容错与版本检测）
* 必须控频、缓存，避免触发风控或违反条款
* 采样任务必须可重入且具备幂等性
* 数据量与请求量控制：MVP 不建议采样全量武器

---

## 3. 外部依赖 API（输入源）

### 3.1 v2 版本与字典（稳定偏高）

* `GET https://api.warframe.market/v2/versions`

  * `data.collections.rivens` 是 Base64(ISO 时间戳)，作为“riven 字典版本号”
* `GET https://api.warframe.market/v2/riven/weapons`

  * 提供紫卡武器字典（slug、name、icon、disposition…）
* `GET https://api.warframe.market/v2/riven/attributes`（可选）

  * 提供词条字典（slug → name/prefix/suffix/unit）

### 3.2 v1 拍卖搜索（实时数据源）

* `GET https://api.warframe.market/v1/auctions/search?type=riven&sort_by=price_asc&weapon_url_name={slug}`
* 响应结构（已抓包确认）：

  * `payload.auctions[]`
  * `buyout_price`、`owner.status`、`closed`、`visible`、`item.weapon_url_name`

---

## 4. 系统总体架构

### 4.1 组件图（逻辑）

1. **Edge API Worker（Hono App）**

* 对外 HTTP API：武器搜索、趋势、当前底价、健康检查
* 内部功能：字典同步、采样调度、写入 D1

2. **Scheduler（Cron）**

* 每 30 分钟触发采样任务（价格 ticks）
* 每日触发字典同步任务（对照 `/v2/versions`）

3. **D1 数据库**

* 存武器字典、采样结果、同步状态、追踪列表、任务锁/执行记录

4. **KV（可选）**

* API 缓存（趋势接口）
* 分布式锁（防 Cron 重入）

### 4.2 数据流

* 字典同步：`v2/versions` → 若版本变化 → `v2/riven/weapons` → D1
* 采样：D1 tracked 武器列表 → v1 auctions search（按武器）→ 过滤 ingame → 计算底价指数 → D1 ticks
* 查询：前端 → Hono API → D1（必要时 KV 缓存）→ 返回 JSON

---

## 5. 数据模型（D1 Schema）

> 所有时间建议存 **UTC ISO 8601 字符串**；并保证采样点 `ts` 对齐到半小时（00/30）。

### 5.1 `sync_state`

记录外部 collection 版本，用于增量同步。

| 字段         | 类型   | 说明                      |
| ---------- | ---- | ----------------------- |
| key (PK)   | TEXT | 例如 `rivens_version_b64` |
| value      | TEXT | base64 版本串              |
| updated_at | TEXT | UTC 时间                  |

---

### 5.2 `riven_weapon_dict`

紫卡武器字典表（来自 v2/riven/weapons）。

| 字段           | 类型      | 说明                                |
| ------------ | ------- | --------------------------------- |
| slug (PK)    | TEXT    | 武器 slug（也用作 v1 的 weapon_url_name） |
| name_en      | TEXT    | 英文名                               |
| icon         | TEXT    | 图标路径                              |
| thumb        | TEXT    | 缩略图路径                             |
| weapon_group | TEXT    | primary/secondary/melee…          |
| riven_type   | TEXT    | rifle/pistol/melee…               |
| disposition  | REAL    | 倾向                                |
| req_mr       | INTEGER | 精通等级                              |
| updated_at   | TEXT    | 同步时间                              |

索引：

* `idx_weapon_name_en(name_en)`（搜索）

---

### 5.3 `tracked_weapon`

控制采样范围（MVP 不建议全量采）。

| 字段        | 类型      | 说明          |
| --------- | ------- | ----------- |
| slug (PK) | TEXT    | 对应武器        |
| enabled   | INTEGER | 0/1         |
| priority  | INTEGER | 优先级（越大越先采样） |
| note      | TEXT    | 可选：备注（热度来源） |

索引：

* `idx_tracked(enabled, priority)`

默认策略：

* 初始只启用 Top N（50/100/200）
* 后续可基于用户查询热度自动加入 tracked

---

### 5.4 `riven_bottom_tick`

价格时间序列核心表。

主键：`(ts, platform, weapon_slug)` 幂等写入，支持重跑覆盖。

| 字段                    | 类型      | 说明                        |
| --------------------- | ------- | ------------------------- |
| ts (PK part)          | TEXT    | 对齐 00/30 的 UTC            |
| platform (PK part)    | TEXT    | `pc`                      |
| weapon_slug (PK part) | TEXT    | 武器 slug                   |
| bottom_price          | INTEGER | 加权底价（可为空）                 |
| sample_count          | INTEGER | 实际样本数（0-5）                |
| min_price             | INTEGER | 底部最小价（可空）                 |
| p5_price              | INTEGER | 第5底价（可空）                  |
| created_at            | TEXT    | 写入时间                      |
| source_status         | TEXT    | 可选：`ok`/`no_data`/`error` |
| error_code            | TEXT    | 可选：失败原因                   |

索引：

* `idx_tick(platform, weapon_slug, ts)`

---

### 5.5 `job_run`（建议）

记录 Cron 执行情况，便于排障与可观测。

| 字段           | 类型   | 说明                             |
| ------------ | ---- | ------------------------------ |
| id (PK)      | TEXT | UUID                           |
| job_name     | TEXT | `sample_ticks` / `sync_rivens` |
| scheduled_ts | TEXT | 触发时间（对齐）                       |
| started_at   | TEXT | 开始                             |
| finished_at  | TEXT | 结束                             |
| status       | TEXT | success/partial/fail           |
| detail       | TEXT | JSON 字符串（成功/失败统计）              |

---

## 6. 采样算法规范（MVP）

### 6.1 过滤规则（严格）

对 `payload.auctions[]`：

* `visible == true`
* `closed == false`
* `owner.status == "ingame"`（只取 ingame）
* `buyout_price != null`
* （可选）`is_direct_sell == true`（若存在且能提高准确性）

### 6.2 取样策略

* 请求参数 `sort_by=price_asc`，列表天然按价格升序
* 顺序扫描符合条件的记录，收集 `buyout_price`
* 为支持异常剔除与补位，最多先收集前 10 个价格（符合条件的）

### 6.3 异常低价剔除（轻量）

当候选价格 `p1,p2,p3...` 满足：

* `len >= 3` 且 `p1 < 0.6 * mean(p2, p3)`
  则丢弃 `p1`，并用后续价格补齐到 5（若存在）。

> 阈值 0.6 后续可配置化，但 MVP 先固定。

### 6.4 加权公式（固定）

权重向量（前 5）：

* `[0.40, 0.25, 0.15, 0.12, 0.08]`

底价指数：

* `bottom_price = Σ(pi * wi)`（按实际样本长度截断权重并归一化或直接截断，需在实现里明确）
  建议：若样本不足 5，则使用对应前 k 权重并 **重新归一化使权重和为 1**，避免低样本导致偏小。

输出：

* `bottom_price`（四舍五入为整数）
* `sample_count`
* `min_price` = 最小价
* `p5_price` = 第 k 个价（k=样本数，最多 5）

### 6.5 无数据策略

* 若 `sample_count == 0`：

  * 写入 tick：`bottom_price = null`
  * `source_status = "no_data"`
  * 便于前端用断点/空点呈现

---

## 7.采样调度设计（方案 ：多 Cron 分片）

### 目标

* 将所有 tracked 武器的采样请求**均匀分布在 30 分钟窗口内**，避免瞬时 QPS 过高触发上游限流（如 3 req/s）。
* 保持趋势数据“时间点对齐”，确保图表稳定、易聚合。

---

### 1) 采样窗口（Sampling Window）

#### 定义

* 一个采样窗口长度：**30 分钟**
* 窗口起点对齐：每小时 `:00` 与 `:30`
* 对于每个武器，要求：**在窗口内至少采样一次**

#### 时间戳策略（强制）

* `tick.ts`：固定写为窗口起点（例如 `2026-01-06T15:30:00Z`）
* `tick.captured_at`（可选）：记录真实抓取时间，用于排障/可观测

> 这样即使请求分散在窗口内，趋势点依然严格对齐到 30 分钟粒度，前端展示与聚合非常干净。

---

### 2) 分片策略（Sharding）

#### 分片数

* 将一个 30 分钟窗口切为 **6 个分片**（每 5 分钟一个槽位）
* 分片编号：`shard ∈ {0,1,2,3,4,5}`

#### 分片函数（稳定均匀）

对每个武器 slug 计算分片：

* `shard = hash(weapon_slug) % 6`

要求：

* hash 必须稳定（同一 slug 永远落到同一 shard）
* 建议使用一致性强的 hash（如 xxhash / murmur / sha1 截断均可）

---

### 3) Cron 触发配置（每 5 分钟一次）

在 Cloudflare Cron Triggers 中配置 6 个触发点：

* `0,30 * * * *` → 执行 shard 0
* `5,35 * * * *` → 执行 shard 1
* `10,40 * * * *` → 执行 shard 2
* `15,45 * * * *` → 执行 shard 3
* `20,50 * * * *` → 执行 shard 4
* `25,55 * * * *` → 执行 shard 5

每次触发任务只处理：

* `tracked_weapon.enabled = 1`
* 且 `hash(slug)%6 == current_shard`

> 如果你不想配置 6 个 cron，也可配置一个每 5 分钟 cron，然后通过当前分钟映射到 shard（但文档建议使用显式 6 触发，逻辑更直观）。

---

### 4) 数据写入幂等性与覆盖策略

#### 主键与幂等

* tick 表主键：`(ts, platform, weapon_slug)`
* 同一窗口同一武器多次采样属于“重复写”

#### 覆盖策略（推荐）

* 采用 UPSERT：如果已存在同主键记录，则以**最新 captured_at**覆盖原记录
* 原因：窗口后段的数据通常更接近“该窗口代表时刻”的真实价格，且能吸收短时波动

---

### 5) 限流与节流（Rate Limiting）

即便分片后，仍建议内置全局节流器，目标：

* **请求速率 ≤ 2 req/sec**（留安全余量）

#### 节流原则

* 不依赖并发本身控制 QPS
* 采用“令牌桶/间隔节流”的设计：

  * 每次发送请求前必须获得 token
  * token 发放速率：2/s
  * 若无 token，等待（sleep/jitter）

#### 并发建议

* `MAX_CONCURRENCY = 5~8`
* 每个请求超时：10s
* 失败重试：最多 1 次（退避 1~3s）

---

### 6) 单次分片任务的执行流程（概念）

每次 Cron（shard k）执行：

1. 计算当前窗口起点 `window_ts`
2. 从 DB 查询本 shard 的 tracked weapons（按 priority DESC 可选）
3. 对每个武器 slug：

   * 请求 v1 auctions search
   * 过滤 `owner.status == "ingame"` + 其它条件
   * 计算 Top5 加权底价
   * UPSERT 写入 tick（ts=window_ts）
4. 写入 job_run 汇总（成功/失败/无数据计数、耗时）

---

### 7) “采样完成性”保障（可选增强）

为了防止某些分片失败导致窗口内缺数据，可加入二级补偿机制：

* 在 `:28` 与 `:58`（窗口末尾）增加一个“补偿 Cron”（可选）

  * 检查本窗口内 sample_count=0 或缺失的武器
  * 低速补采少量失败项
* MVP 可先不做，等线上稳定后再加


## 8. 查询与性能策略

### 8.1 趋势查询 SQL（概念）

* 通过 `(platform, weapon_slug, ts)` 索引做范围查询
* range → 起始时间 `now - range`
* 返回按 `ts ASC` 排序

### 8.2 缓存

* `/api/riven/bottom-trend` 可缓存 5~10 分钟
* `/api/weapons` 可缓存 1 小时（字典不频繁变化）
* 缓存层：KV（可选），或 Cloudflare Cache API（可选）

---

## 9. 错误处理与返回规范

### 9.1 API 返回规范

* 成功：HTTP 200，`{ data: ... }`
* 参数错误：HTTP 400，`{ error: { code, message } }`
* 未找到武器：HTTP 404
* 服务器错误：HTTP 500（内部记录 job_run/detail）

### 9.2 外部 API 错误处理（采样任务）

* 单武器失败不影响全局任务
* 记录 `source_status="error"`，并写 `error_code`
* job_run 汇总：

  * success_count / no_data_count / error_count
  * 平均耗时、最长耗时

---

## 11. 安全、合规与隐私

### 11.1 合规原则

* 不展示卖家用户名、联系方式、完整拍卖列表
* 仅保存聚合结果（tick）
* 控频、缓存，避免高频抓取

### 11.2 隐私

* 不保存 `owner.ingame_name`
* 不保存 `auction.id`（MVP 不需要）
* 仅保存价格与样本统计

---

## 11. 部署与配置管理

### 11.1 环境与配置（Workers Secrets / Vars）

* `WARFRAME_MARKET_V1_BASE=https://api.warframe.market/v1`
* `WARFRAME_MARKET_V2_BASE=https://api.warframe.market/v2`
* `DEFAULT_PLATFORM=pc`
* `SAMPLE_INTERVAL_MINUTES=30`
* `MAX_CONCURRENCY=8`
* `FETCH_TIMEOUT_MS=10000`
* `TOP_N=5`
* `CANDIDATE_MAX=10`
* `OUTLIER_RATIO=0.6`
* `WEIGHTS=0.40,0.25,0.15,0.12,0.08`

### 11.2 发布策略

* 使用 wrangler 部署
* D1 migrations 管理 schema
* 新版本先灰度（可选：分环境 staging/prod）

### 11.3 回滚策略

* Worker 回滚到上一个版本
* D1 schema 变更尽量向前兼容（新增列为主）
* job_run 用于确认回滚后任务恢复

---

## 12. 可观测性（Observability）

### 12.1 日志

* 采样任务开始/结束
* 外部 API 请求失败（含 weapon_slug、HTTP code）
* job_run 汇总写入 D1

### 12.2 指标（建议）

* 每次采样：

  * processed_weapons
  * success/no_data/error
  * duration_ms
* API：

  * trend 请求量
  * cache hit rate（如果启用 KV）

---

## 13. 未来扩展（不进入 MVP）

* 多平台支持（Platform header / crossplay 维度）
* reroll 分档趋势（0/1-10/10+）
* 词条筛选（使用 v2/riven/attributes）
* 趋势提醒（WebPush/Email）
* 付费订阅（更多历史、更细粒度、更多武器、提醒）

---

## 14. 交付清单（给 Cursor 的任务拆解建议）

1. D1 schema + migrations
2. Hono 路由定义与响应模型
3. 外部 API client（v1/v2）与超时/重试策略
4. 字典同步 job（versions 对比 + upsert weapons）
5. 采样 job（读取 tracked → fetch auctions → 过滤 → 算法 → 写 tick）
6. 基础缓存（可选 KV）
7. job_run 记录与 health endpoint


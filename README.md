# WebUtilityKit Lab（AI Incubator）

> **Domain**：`lab.webutilitykit.com`  
> **Infrastructure**：Cloudflare Global Network（Edge Computing）  
> **Runtime (Primary)**：[Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Static Assets](https://developers.cloudflare.com/workers/static-assets/)  
> **Status**：Experimental / Beta / AI-Driven Development

---

## 1. 项目定位

**WebUtilityKit Lab** 是一个基于 **Cloudflare Workers** 的 AI 辅助全栈孵化器，用来把“想法”快速孵化成可上线的小工具。

- **核心目标**：以“边缘优先”的方式交付低延迟、小成本、全球部署的 Web 工具。
- **工程目标**：同一套规范下承载多个小应用（多入口、多路由、共享基础设施）。
- **AI-Native**：把 AI 当作能力层（Workers AI / 代理调用 / 速率限制兜底），而不是把密钥塞进前端。

---

## 2. 推荐架构（更可执行的形态）

本仓库建议采用 **“一个 Worker 统一入口 + 静态资源托管 + API 路由分层”** 的架构。

### 2.1 请求流（高层）

```text
Browser
  |
  | 1) GET /, /apps/**, /assets/**    (静态资源)
  v
Workers Static Assets (CDN/Edge)
  |
  | 2) /api/** 命中 Worker 逻辑（鉴权/限流/业务）
  v
Cloudflare Worker (Router + Middleware + Handlers)
  |
  +--> D1 / KV / R2 / Durable Objects / Workers AI（按需绑定）
```


### 2.2 部署单元策略（从“孵化”到“规模化”的演进路径）

- **默认（推荐）**：**单 Worker + 多 App**  
  - 优点：统一鉴权/限流/日志/错误处理；发布与回滚简单；最适合孵化阶段。
- **进阶（按需）**：**按 App 拆 Worker（或把重型能力拆为独立 Worker）**  
  - 触发条件：某个 App 依赖/构建链很重、发布频率高、风险隔离诉求强、需要不同缓存/路由策略。
  - 目标：让“大应用”不拖累孵化器主干，同时保留统一规范与共享组件。

---

## 3. 技术栈与能力（对齐官方文档）

### 3.1 运行时与开发工具

- **Compute**：Cloudflare Workers（Web 标准 API；入口通常为模块化 `export default { fetch(...) }` 形式）  
  - 参考：[Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/)
- **API Router**：Hono（用于 `/api/**` 的路由与中间件；保持 `fetch()` 层仅做分流）  
  - 参考：[Hono](https://hono.dev/)
- **CLI**：Wrangler  
  - 参考：[Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- **Static Assets**：Workers Static Assets（把 `public/` 作为静态资源目录，由边缘分发）  
  - 参考：[Static Assets](https://developers.cloudflare.com/workers/static-assets/)

### 3.2 存储与 AI（按需启用）

- **D1（SQL）**：关系型数据（工具的核心业务数据）  
  - 参考：[D1](https://developers.cloudflare.com/d1/)
- **KV（低一致/高读）**：配置、轻缓存、可接受延迟一致的读取  
  - 参考：[KV](https://developers.cloudflare.com/kv/)
- **R2（对象存储）**：导出文件、图片、PDF、附件等  
  - 参考：[R2](https://developers.cloudflare.com/r2/)
- **Workers AI**：边缘推理（务必包含超时/限流兜底）  
  - 参考：[Workers AI](https://developers.cloudflare.com/workers-ai/)

### 3.3 可观测性（建议从第一天就纳入）

- 参考：[Observability](https://developers.cloudflare.com/workers/observability/)

---

## 4. 目录结构规范（面向 Workers）

**约束：禁止随意在根目录散落文件。新增内容必须归类到以下目录之一。**

```text
/webutilitykit-lab (Root)
├── public/                  # 静态资源根（由 Workers Static Assets 分发）
│   ├── index.html            # Lab 大厅（Dashboard：所有 App 入口）
│   ├── assets/               # 全局静态资源（Logo / Global CSS / Common Libs）
│   └── apps/                 # 每个 App 的前端（自包含）
│       ├── _template/
│       ├── resume-builder/
│       └── ...
│
├── src/                      # Worker 源码（统一入口、路由、中间件、handlers）
│   ├── index.ts              # Worker 入口（fetch）
│   ├── router/               # 路由与分发（/api/**）
│   ├── middleware/           # 共享中间件（auth/cors/rate-limit/logging）
│   ├── api/                  # 公共 API（例如 ai-proxy、health、usage）
│   └── apps/                 # 每个 App 的后端逻辑（按 app-name 分目录）
│       ├── resume-builder/
│       └── ...
│
├── wrangler.toml              # 部署与绑定（KV/D1/R2/AI/vars/compatibility）
├── package.json               # 依赖与脚本（wrangler、ts、lint/test 可选）
└── README.md                  # 本文件
```

---

## 5. 路由与约定（让“多 App 孵化器”可维护）

- **静态页面**
  - `/`：Lab 大厅（`public/index.html`）
  - `/apps/<app-name>/...`：每个应用的静态前端入口与资源
  - `/assets/...`：全局共享静态资源
- **API**
  - `/api/<app-name>/...`：对应 `src/apps/<app-name>/` 的 handlers
  - `/api/_/health`、`/api/_/version`：公共平台级 API（放 `src/api/`）

建议从第一天就引入 **版本化**（例如 `/api/v1/...`），避免未来破坏性变更。

### 5.1 当前实现约定（重要：与代码保持一致）

- **/api 统一走 Hono**：`src/index.ts` 内使用 Hono 承接 `/api/**`（路由/中间件/404/错误处理）。
- **静态资源不经 Hono**：非 `/api/**` 请求直接回退到 `env.ASSETS.fetch(request)`（Workers Static Assets 分发 `public/`）。
- **新增 API 路由的推荐方式**：在 Hono app 上增加路由（而不是在 `fetch()` 里堆 `if/else`）。

例如（示意，真实代码以 `src/index.ts` 为准）：

```ts
// api.get("/api/my-app/hello", (c) => c.json({ ok: true }))
```

---

## 6. 本地开发与部署（Wrangler）

### 6.1 初始化（首次）

- 创建/补全 Worker 项目：使用官方推荐脚手架 `npm create cloudflare@latest`（或在现有仓库中补齐 `src/`、`public/`、`wrangler.toml`）。
- 登录：`wrangler login`

### 6.2 本地运行

- **开发**：`wrangler dev`  
  - 说明：它会在本地模拟 Workers 运行时与路由（并可加载绑定）。

### 6.3 部署

- **部署**：`wrangler deploy`

### 6.4 密钥与环境变量（严禁前端写 Key）

- **Secrets**：使用 `wrangler secret put <NAME>` 管理敏感信息（例如第三方 API Key）。
- **非敏感 vars**：写入 `wrangler.toml` 的 `[vars]`（例如功能开关、默认模型名）。

---

## 7. 🤖 AI Agent 开发准则（Crucial）

### 原则 1：边缘优先（Edge-First）

- 能在 Worker 内解决的逻辑不要依赖外部服务。
- 通过 `env`（而不是硬编码）访问 D1/KV/R2/AI 等绑定；入口签名遵循模块化 Workers 约定：`fetch(request, env, ctx)`。

### 原则 2：隔离与自包含（Isolation）

- 每个应用在 `public/apps/<app-name>/` 下必须是功能闭环的。
- **禁止跨应用修改代码**。修改 `public/index.html`（大厅）时只允许追加入口卡片，不得破坏既有布局与链接。

### 原则 3：安全与 API 管理（Security）

- **严禁**在任何前端 `.html` / `.js` 中写入 API Key / Token。
- 所有敏感调用必须走 `/api/**`，从 `env` 读取 Secrets，并加入：
  - **鉴权（如需）**：基于 header/token/Turnstile 等
  - **速率限制**：按 IP/用户/令牌维度（可用 KV/DO 实现）
  - **超时与降级**：Workers AI / 外部 API 出错时必须有 fallback

### 原则 4：高性能加载（Performance）

- 静态资源可优先用 CDN（Alpine/Vue/Tailwind），并利用缓存头提升命中率。
- 应用必须包含 Skeleton/Loading，且避免阻塞主线程的长任务。

---

## 8. 新应用开发工作流（建议）

1. **创建前端**：从 `public/apps/_template` 复制到 `public/apps/my-new-app/`，完成 UI 与页面入口。
2. **创建后端（可选）**：在 `src/apps/my-new-app/` 增加 handlers，并把路由挂到 `/api/my-new-app/**`。
3. **配置绑定（可选）**：在 `wrangler.toml` 中绑定 D1/KV/R2/AI（按需最小化）。
4. **本地调试**：`wrangler dev`（覆盖静态 + API 端到端）。
5. **注册入口**：在 `public/index.html` 增加一个 Bento Card，并标记状态（Alpha/Beta/Stable）。

---

> **Note to AI**：This is a production-grade incubator. Prioritize **serverless best practices**, **atomic CSS**, and **async-first logic**. When using Workers AI, always include **timeouts / rate-limit fallback / graceful degradation**.
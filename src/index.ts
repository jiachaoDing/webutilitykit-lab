import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { timing } from "hono/timing";
import rivenTrackerApp from "./apps/RivenTracker/routes";
import { handleScheduled } from "./apps/RivenTracker/jobs";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_NAME: string;
  APP_VERSION: string;
}

const api = new Hono<{ Bindings: Env }>();

// CORS（主要给跨域调试/未来前后端分离场景用；如不需要可再收紧）
api.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

api.use('*', logger())
api.use('*', timing())

// 公共平台级 API
api.get("/api/_/health", (c) => {
  return c.json({ status: "ok", time: new Date().toISOString() });
});

api.get("/api/_/version", (c) => {
  return c.json({ name: c.env.APP_NAME, version: c.env.APP_VERSION });
});

// 示例 App API 路由分发
api.all("/api/_template/*", (c) => {
  return c.json({ message: "Hello from _template API!" });
});

// Riven Tracker API
api.route("/api/RivenTracker", rivenTrackerApp);

api.notFound((c) => {
  return c.json({ error: "API route not found" }, 404);
});

api.onError((err, c) => {
  // 避免把内部堆栈暴露给客户端
  console.error("API error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. 处理 API 路由
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    // 2. 默认回退到静态资源托管 (Workers Static Assets)
    // 注意：如果路径匹配到 public 中的文件，env.ASSETS.fetch 会自动处理
    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  },
};

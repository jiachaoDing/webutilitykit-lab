export interface D1RetryOptions {
  attempts?: number;      // 默认 3
  baseDelayMs?: number;   // 默认 200ms
  maxDelayMs?: number;    // 默认 1500ms
}

function isRetryableD1Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // 目前观测到的症状：D1 客户端解析响应失败（拿到空/非 JSON body）
  if (msg.includes("D1_ERROR: Failed to parse body as JSON")) return true;
  // 保守：有些 D1 传输层错误也可能通过重试恢复
  if (msg.includes("D1_ERROR") && msg.includes("fetch")) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function d1WithRetry<T>(
  opName: string,
  fn: () => Promise<T>,
  opts?: D1RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? 3);
  const baseDelayMs = Math.max(0, opts?.baseDelayMs ?? 200);
  const maxDelayMs = Math.max(baseDelayMs, opts?.maxDelayMs ?? 1500);

  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableD1Error(e) || i === attempts) break;

      const backoff = Math.min(maxDelayMs, baseDelayMs * i);
      // 加一点 jitter，避免多实例同频重试
      const jitter = Math.floor(Math.random() * 50);
      console.warn(`[D1Retry] ${opName} failed (attempt ${i}/${attempts}), retry in ${backoff + jitter}ms: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(backoff + jitter);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}



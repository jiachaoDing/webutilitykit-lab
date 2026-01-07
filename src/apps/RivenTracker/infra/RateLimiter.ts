/**
 * 极简的令牌桶/速率限制器，用于控制 API 请求频率。
 */
export class RateLimiter {
  private lastTime = 0;
  private interval: number;

  constructor(rps: number) {
    this.interval = 1000 / rps;
  }

  async throttle() {
    const now = Date.now();
    const wait = this.lastTime + this.interval - now;
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
      this.lastTime = Date.now();
    } else {
      this.lastTime = now;
    }
  }
}


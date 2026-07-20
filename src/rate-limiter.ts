/** Последовательная очередь VK Ads: не более одного запроса на credential в секунду. */
export class TokenRateLimiter {
  private nextAllowedAt = 0;

  async wait(): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextAllowedAt);
    this.nextAllowedAt = scheduledAt + 1_000;
    const delay = scheduledAt - now;
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

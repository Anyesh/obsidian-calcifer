/**
 * Rate Limiter
 * 
 * Implements a simple token bucket rate limiter.
 */

/**
 * Rate Limiter using token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond
  private lastRefill: number;
  private waitQueue: Array<() => void> = [];

  /**
   * Create a rate limiter
   * 
   * @param requestsPerMinute Maximum requests per minute
   */
  constructor(requestsPerMinute: number) {
    this.maxTokens = Math.max(1, requestsPerMinute);
    this.tokens = this.maxTokens;
    this.refillRate = requestsPerMinute / (60 * 1000); // tokens per ms
    this.lastRefill = Date.now();
  }

  /**
   * Acquire a token, waiting if necessary
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
      this.scheduleRefill();
    });
  }

  /**
   * Try to acquire a token without waiting
   * 
   * @returns True if token was acquired
   */
  tryAcquire(): boolean {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    
    return false;
  }

  /**
   * Get current token count
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillScheduled = false;

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;

    while (this.tokens >= 1 && this.waitQueue.length > 0) {
      this.tokens--;
      const resolve = this.waitQueue.shift()!;
      resolve();
    }

    if (this.waitQueue.length > 0) {
      this.scheduleRefill();
    }
  }

  private scheduleRefill(): void {
    if (this.refillScheduled) return;
    this.refillScheduled = true;

    const deficit = Math.max(0, 1 - this.tokens);
    const timeToNextToken = Math.ceil(deficit / this.refillRate);
    setTimeout(() => {
      this.refillScheduled = false;
      this.refill();
    }, Math.max(10, timeToNextToken));
  }
}

/**
 * Simple queue with concurrency limit
 */
export class ConcurrencyLimiter {
  private running = 0;
  private maxConcurrency: number;
  private queue: Array<() => Promise<void>> = [];

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Run a function with concurrency limiting
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      if (this.running < this.maxConcurrency) {
        void execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private processQueue(): void {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      void next();
    }
  }
}

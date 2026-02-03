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
    
    // Wait for a token with a maximum wait time
    return new Promise((resolve) => {
      // Calculate time until next token
      const timeToNextToken = Math.ceil((1 - this.tokens) / this.refillRate);
      const maxWait = Math.min(timeToNextToken, 2000); // Never wait more than 2 seconds
      
      setTimeout(() => {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens--;
        }
        resolve();
      }, maxWait);
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
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
    
    // Process waiting requests
    while (this.tokens >= 1 && this.waitQueue.length > 0) {
      this.tokens--;
      const resolve = this.waitQueue.shift()!;
      resolve();
    }
  }

  /**
   * Schedule a refill check
   */
  private scheduleRefill(): void {
    const timeToNextToken = (1 - (this.tokens % 1)) / this.refillRate;
    
    setTimeout(() => {
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

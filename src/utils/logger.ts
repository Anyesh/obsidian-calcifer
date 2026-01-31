/**
 * Logger Utility
 * 
 * Provides consistent logging with levels and formatting.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry
 */
interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  minLevel: LogLevel;
  enableConsole: boolean;
  maxHistory: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger class
 */
export class Logger {
  private config: LoggerConfig;
  private history: LogEntry[] = [];
  private module: string;

  constructor(module: string, config: Partial<LoggerConfig> = {}) {
    this.module = module;
    this.config = {
      minLevel: config.minLevel ?? 'info',
      enableConsole: config.enableConsole ?? true,
      maxHistory: config.maxHistory ?? 100,
    };
  }

  /**
   * Create a child logger with a sub-module name
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`, this.config);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Get log history
   */
  getHistory(): LogEntry[] {
    return [...this.history];
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      module: this.module,
      message,
      data,
    };

    // Add to history
    this.history.push(entry);
    if (this.history.length > this.config.maxHistory) {
      this.history.shift();
    }

    // Console output
    if (this.config.enableConsole) {
      const prefix = `[Calcifer:${this.module}]`;
      const consoleMethod = level === 'error' ? 'error' :
                           level === 'warn' ? 'warn' :
                           level === 'debug' ? 'debug' : 'log';
      
      if (data !== undefined) {
        console[consoleMethod](prefix, message, data);
      } else {
        console[consoleMethod](prefix, message);
      }
    }
  }
}

/**
 * Create a logger for a module
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

// Default logger
export const logger = createLogger('core');

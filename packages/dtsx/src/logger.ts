/**
 * Logger abstraction for dtsx
 * Provides configurable logging with verbosity levels
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

export interface LoggerOptions {
  level?: LogLevel
  prefix?: string
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  setLevel: (level: LogLevel) => void
  getLevel: () => LogLevel
}

let currentLevel: LogLevel = 'info'
let currentPrefix = '[dtsx]'

/**
 * Check if a log level should be output given the current level
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel]
}

/**
 * Format log arguments with prefix
 */
function formatArgs(args: unknown[]): unknown[] {
  if (currentPrefix) {
    return [currentPrefix, ...args]
  }
  return args
}

/**
 * Create a logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  if (options.level) {
    currentLevel = options.level
  }
  if (options.prefix !== undefined) {
    currentPrefix = options.prefix
  }

  return {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        console.debug(...formatArgs(args))
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        console.log(...formatArgs(args))
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        console.warn(...formatArgs(args))
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        console.error(...formatArgs(args))
      }
    },
    setLevel: (level: LogLevel) => {
      currentLevel = level
    },
    getLevel: () => currentLevel,
  }
}

/**
 * Default logger instance
 */
export const logger = createLogger()

/**
 * Set the global log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLevel
}

/**
 * Set the log prefix
 */
export function setLogPrefix(prefix: string): void {
  currentPrefix = prefix
}

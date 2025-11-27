/**
 * Logger abstraction for dtsx
 * Provides configurable logging with verbosity levels and scoped loggers
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
  /** Enable timestamps in log output */
  timestamps?: boolean
  /** Custom output function (useful for testing) */
  output?: (level: LogLevel, ...args: unknown[]) => void
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  setLevel: (level: LogLevel) => void
  getLevel: () => LogLevel
  /** Create a child logger with a scope prefix */
  child: (scope: string) => Logger
  /** Start a timer and return a function to log elapsed time */
  time: (label: string) => () => void
  /** Log a progress message (info level, no newline in TTY) */
  progress: (message: string) => void
}

let currentLevel: LogLevel = 'info'
let currentPrefix = '[dtsx]'
let showTimestamps = false
let customOutput: ((level: LogLevel, ...args: unknown[]) => void) | null = null

/**
 * Check if a log level should be output given the current level
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel]
}

/**
 * Format timestamp
 */
function formatTimestamp(): string {
  if (!showTimestamps)
    return ''
  const now = new Date()
  return `[${now.toISOString().slice(11, 23)}] `
}

/**
 * Format log arguments with prefix
 */
function formatArgs(prefix: string, args: unknown[]): unknown[] {
  const timestamp = formatTimestamp()
  if (prefix || timestamp) {
    return [`${timestamp}${prefix}`, ...args]
  }
  return args
}

/**
 * Output to appropriate console method
 */
function output(level: LogLevel, prefix: string, args: unknown[]): void {
  const formattedArgs = formatArgs(prefix, args)

  if (customOutput) {
    customOutput(level, ...formattedArgs)
    return
  }

  switch (level) {
    case 'debug':
      console.debug(...formattedArgs)
      break
    case 'info':
      console.log(...formattedArgs)
      break
    case 'warn':
      console.warn(...formattedArgs)
      break
    case 'error':
      console.error(...formattedArgs)
      break
  }
}

/**
 * Create a logger instance with optional scope
 */
function createLoggerWithPrefix(prefix: string): Logger {
  const logger: Logger = {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        output('debug', prefix, args)
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        output('info', prefix, args)
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        output('warn', prefix, args)
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        output('error', prefix, args)
      }
    },
    setLevel: (level: LogLevel) => {
      currentLevel = level
    },
    getLevel: () => currentLevel,
    child: (scope: string) => {
      const childPrefix = prefix ? `${prefix}:${scope}` : `[${scope}]`
      return createLoggerWithPrefix(childPrefix)
    },
    time: (label: string) => {
      const start = performance.now()
      return () => {
        const elapsed = performance.now() - start
        if (shouldLog('debug')) {
          output('debug', prefix, [`${label}: ${elapsed.toFixed(2)}ms`])
        }
      }
    },
    progress: (message: string) => {
      if (shouldLog('info')) {
        // Use process.stdout.write for progress in TTY, otherwise regular log
        if (typeof process !== 'undefined' && process.stdout?.isTTY) {
          process.stdout.write(`\r${prefix} ${message}`)
        }
        else {
          output('info', prefix, [message])
        }
      }
    },
  }

  return logger
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
  if (options.timestamps !== undefined) {
    showTimestamps = options.timestamps
  }
  if (options.output) {
    customOutput = options.output
  }

  return createLoggerWithPrefix(currentPrefix)
}

/**
 * Default logger instance
 */
export const logger: Logger = createLoggerWithPrefix(currentPrefix)

/**
 * Create a scoped logger for a specific module
 * @example
 * const log = scopedLogger('extractor')
 * log.debug('Parsing file...') // [dtsx:extractor] Parsing file...
 */
export function scopedLogger(scope: string): Logger {
  return logger.child(scope)
}

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

/**
 * Enable or disable timestamps
 */
export function setTimestamps(enabled: boolean): void {
  showTimestamps = enabled
}

/**
 * No-op logger for silent mode or testing
 */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  setLevel: () => {},
  getLevel: () => 'silent',
  child: () => nullLogger,
  time: () => () => {},
  progress: () => {},
}

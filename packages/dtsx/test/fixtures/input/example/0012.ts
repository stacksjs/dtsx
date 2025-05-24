/**
 * Main module documentation
 * This module demonstrates various comment types
 * @author Test Author
 * @version 1.0.0
 */

/**
 * Configuration options for the application
 * @template T - The type of the configuration data
 */
export interface ConfigOptions<T> {
  /** The name of the configuration */
  name: string
  
  /**
   * The current working directory
   * @default process.cwd()
   */
  cwd?: string
  
  /** Default configuration values */
  defaultConfig: T
  
  /**
   * Whether to enable verbose logging
   * @remarks This affects performance
   */
  verbose?: boolean
}

/**
 * A utility type for optional properties
 * @example
 * ```typescript
 * type User = Optional<{ name: string; age: number }, 'age'>
 * // Result: { name: string; age?: number }
 * ```
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Status enumeration for operations
 * @enum {string}
 */
export enum Status {
  /** Operation is pending */
  PENDING = 'pending',
  
  /** Operation completed successfully */
  SUCCESS = 'success',
  
  /** Operation failed with error */
  ERROR = 'error',
  
  /**
   * Operation was cancelled
   * @deprecated Use ABORTED instead
   */
  CANCELLED = 'cancelled',
  
  /** Operation was aborted */
  ABORTED = 'aborted'
}

/**
 * Application logger class
 * @example
 * ```typescript
 * const logger = new Logger('MyApp')
 * logger.info('Application started')
 * ```
 */
export class Logger {
  /** The logger name */
  private name: string
  
  /**
   * Creates a new logger instance
   * @param name - The logger name
   */
  constructor(name: string) {
    this.name = name
  }
  
  /**
   * Log an info message
   * @param message - The message to log
   * @param data - Optional additional data
   */
  info(message: string, data?: any): void {
    console.log(`[${this.name}] INFO: ${message}`, data)
  }
  
  /**
   * Log an error message
   * @param message - The error message
   * @param error - Optional error object
   * @throws {Error} When logging fails
   */
  error(message: string, error?: Error): void {
    console.error(`[${this.name}] ERROR: ${message}`, error)
  }
  
  /**
   * Log a debug message
   * @internal This method is for internal use only
   */
  debug(message: string): void {
    if (process.env.DEBUG) {
      console.debug(`[${this.name}] DEBUG: ${message}`)
    }
  }
}

/**
 * Load configuration from file
 * @param options - Configuration loading options
 * @returns Promise that resolves to the loaded configuration
 * @throws {Error} When configuration file is not found
 * @example
 * ```typescript
 * const config = await loadConfig({
 *   name: 'myapp',
 *   cwd: './config',
 *   defaultConfig: { port: 3000 }
 * })
 * ```
 */
export async function loadConfig<T extends Record<string, unknown>>(
  options: ConfigOptions<T>
): Promise<T> {
  const { name, cwd = process.cwd(), defaultConfig } = options
  
  // Try to load the configuration file
  try {
    const configPath = `${cwd}/${name}.config.js`
    const imported = await import(configPath)
    return { ...defaultConfig, ...imported.default }
  } catch (error) {
    // Return default config if file not found
    return defaultConfig
  }
}

/**
 * Utility function to merge objects deeply
 * @param target - The target object
 * @param source - The source object to merge
 * @returns The merged object
 * @internal
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  return { ...target, ...source }
}

/**
 * Constants for the application
 */
export const APP_CONSTANTS = {
  /** Default port number */
  DEFAULT_PORT: 3000,
  
  /** Maximum retry attempts */
  MAX_RETRIES: 3,
  
  /**
   * Timeout duration in milliseconds
   * @default 5000
   */
  TIMEOUT: 5000,
  
  /** Application version */
  VERSION: '1.0.0'
} as const

/**
 * Database connection options
 * @namespace Database
 */
export namespace Database {
  /**
   * Connection configuration
   */
  export interface ConnectionConfig {
    /** Database host */
    host: string
    
    /** Database port */
    port: number
    
    /**
     * Database name
     * @example 'myapp_production'
     */
    database: string
    
    /** Username for authentication */
    username: string
    
    /** Password for authentication */
    password: string
  }
  
  /**
   * Connect to the database
   * @param config - Connection configuration
   * @returns Promise that resolves when connected
   */
  export function connect(config: ConnectionConfig): Promise<void> {
    return Promise.resolve()
  }
}

// Single line comment for variable
/** Multi-line comment for exported variable */
export const API_VERSION = '2.0.0'

/* Block comment style */
export const DEBUG_MODE = process.env.NODE_ENV === 'development'

/**
 * @deprecated Use the new API instead
 * @see {@link loadConfig}
 */
export function legacyLoadConfig(): void {
  // Implementation
} 
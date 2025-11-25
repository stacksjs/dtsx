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
export declare function loadConfig<T extends Record<string, unknown>>(options: ConfigOptions<T>): Promise<T>;
/**
 * @deprecated Use the new API instead
 * @see {@link loadConfig}
 */
export declare function legacyLoadConfig(): void;
/**
 * Constants for the application
 */
export declare const APP_CONSTANTS: {
  /** Default port number */
  DEFAULT_PORT: 3000;
  /** Maximum retry attempts */
  MAX_RETRIES: 3;
  /**
   * Timeout duration in milliseconds
   * @default 5000
   */
  TIMEOUT: 5000;
  /** Application version */
  VERSION: '1.0.0'
};
/** Multi-line comment for exported variable */
export declare const API_VERSION: '2.0.0';
/* Block comment style */
export declare const DEBUG_MODE: unknown;
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
export declare interface ConfigOptions<T> {
  name: string
  cwd?: string
  defaultConfig: T
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
 * Application logger class
 * @example
 * ```typescript
 * const logger = new Logger('MyApp')
 * logger.info('Application started')
 * ```
 */
export declare class Logger {
  private name: string;
  constructor(name: string);
  info(message: string, data?: any): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}
/**
 * Status enumeration for operations
 * @enum {string}
 */
export declare enum Status {
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
 * Database connection options
 * @namespace Database
 */
export declare namespace Database {
  export interface ConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
}
  export function connect(config: ConnectionConfig): Promise<void>;
}

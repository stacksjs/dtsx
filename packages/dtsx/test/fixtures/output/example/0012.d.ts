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
  /** The name of the configuration */
  name: string;
  /**
   * The current working directory
   * @default process.cwd()
   */
  cwd?: string;
  /** Default configuration values */
  defaultConfig: T;
  /**
   * Whether to enable verbose logging
   * @remarks This affects performance
   */
  verbose?: boolean;
}

/**
 * A utility type for optional properties
 * @example
 * ```typescript
 * type User = Optional<{ name: string; age: number }, 'age'>
 * // Result: { name: string; age?: number }
 * ```
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

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
 * Application logger class
 * @example
 * ```typescript
 * const logger = new Logger('MyApp')
 * logger.info('Application started')
 * ```
 */
export declare class Logger {
  private name: string;
  /**
   * Creates a new logger instance
   * @param name - The logger name
   */
  constructor(name: string);
  /**
   * Log an info message
   * @param message - The message to log
   * @param data - Optional additional data
   */
  info(message: string, data?: any): void;
  /**
   * Log an error message
   * @param message - The error message
   * @param error - Optional error object
   * @throws {Error} When logging fails
   */
  error(message: string, error?: Error): void;
  /**
   * Log a debug message
   * @internal This method is for internal use only
   */
  debug(message: string): void;
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
export declare function loadConfig<T extends Record<string, unknown>>(options: ConfigOptions<T>): Promise<T>;

/**
 * Constants for the application
 */
export declare const APP_CONSTANTS: {
  /** Default port number */
  readonly DEFAULT_PORT: 3000;
  /** Maximum retry attempts */
  readonly MAX_RETRIES: 3;
  /**
   * Timeout duration in milliseconds
   * @default 5000
   */
  readonly TIMEOUT: 5000;
  /** Application version */
  readonly VERSION: "1.0.0";
};

/**
 * Database connection options
 * @namespace Database
 */
export declare namespace Database {
  /**
   * Connection configuration
   */
  export interface ConnectionConfig {
    /** Database host */
    host: string;
    /** Database port */
    port: number;
    /**
     * Database name
     * @example 'myapp_production'
     */
    database: string;
    /** Username for authentication */
    username: string;
    /** Password for authentication */
    password: string;
  }
  /**
   * Connect to the database
   * @param config - Connection configuration
   * @returns Promise that resolves when connected
   */
  export function connect(config: ConnectionConfig): Promise<void>;
}

// Single line comment for variable
/** Multi-line comment for exported variable */
export declare const API_VERSION: "2.0.0";

/* Block comment style */
export declare const DEBUG_MODE: boolean;

/**
 * @deprecated Use the new API instead
 * @see {@link loadConfig}
 */
export declare function legacyLoadConfig(): void; 
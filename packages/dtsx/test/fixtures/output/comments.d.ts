// Single-line comment before re-export
export type { Config as ConfigType };
/**
 * Fetches data from the API
 * @param url - The URL to fetch from
 * @param options - Optional fetch options
 * @returns A promise that resolves to the response data
 * @throws {Error} When the request fails
 * @example
 * ```ts
 * const data = await fetchData('/api/users')
 * ```
 */
export declare function fetchData<T>(url: string, options?: RequestInit): Promise<T>;
/**
 * A constant configuration object
 * @see {@link Config}
 */
export declare const DEFAULT_CONFIG: {
  debug: false;
  timeout: 5000;
  retries: 3
};
/**
 * Comment preservation test fixture
 */
/**
 * A simple user interface
 * @description Represents a user in the system
 */
export declare interface User {
  id: number
  name: string
  email?: string
}
/**
 * Configuration options for the application
 * @template T The type of the configuration values
 */
export declare interface Config<T> {
  debug: boolean
  values: T
}
/**
 * A type alias for callback functions
 * @template T The input type
 * @template R The return type
 */
export type Callback<T, R = void> = (value: T) => R;
/**
 * Utility class for string operations
 */
export declare class StringUtils {
  static capitalize(str: string): string;
  static truncate(str: string, maxLength: number, suffix?: string): string;
}
/**
 * Application status enum
 * @enum {string}
 */
export declare enum AppStatus {
  /** Application is starting up */
  Starting = 'starting',
  /** Application is running */
  Running = 'running',
  /** Application is shutting down */
  Stopping = 'stopping',
  /** Application has stopped */
  Stopped = 'stopped',
}
/* Block comment before export */
export { User as UserType };

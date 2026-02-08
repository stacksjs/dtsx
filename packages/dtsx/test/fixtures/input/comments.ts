/**
 * Comment preservation test fixture
 */

/**
 * A simple user interface
 * @description Represents a user in the system
 */
export interface User {
  /** The unique identifier */
  id: number
  /**
   * The user's full name
   * @example "John Doe"
   */
  name: string
  /** Optional email address */
  email?: string
}

/**
 * Configuration options for the application
 * @template T The type of the configuration values
 */
export interface Config<T> {
  /** Whether debug mode is enabled */
  debug: boolean
  /** The configuration values */
  values: T
}

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
export async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  return response.json()
}

/**
 * A constant configuration object
 * @see {@link Config}
 */
export const DEFAULT_CONFIG = {
  debug: false,
  timeout: 5000,
  retries: 3,
} as const

/**
 * Application status enum
 * @enum {string}
 */
export enum AppStatus {
  /** Application is starting up */
  Starting = 'starting',
  /** Application is running */
  Running = 'running',
  /** Application is shutting down */
  Stopping = 'stopping',
  /** Application has stopped */
  Stopped = 'stopped',
}

/**
 * A type alias for callback functions
 * @template T The input type
 * @template R The return type
 */
export type Callback<T, R = void> = (value: T) => R

/**
 * Utility class for string operations
 */
export class StringUtils {
  /**
   * Capitalizes the first letter of a string
   * @param str - The input string
   * @returns The capitalized string
   */
  static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Truncates a string to the specified length
   * @param str - The input string
   * @param maxLength - Maximum length
   * @param suffix - Suffix to add when truncated
   */
  static truncate(str: string, maxLength: number, suffix: string = '...'): string {
    if (str.length <= maxLength) return str
    return str.slice(0, maxLength - suffix.length) + suffix
  }
}

/* Block comment before export */
export { User as UserType }

// Single-line comment before re-export
export type { Config as ConfigType }

// A default on an object-typed parameter makes it optional, and the
// initializer is dropped.
export declare function resilient(config?: { sentryDsn?: string, bugsnagApiKey?: string, services?: string[] }): void;
/**
 * Getters and setters in an object literal are accessors, not
 * function-typed properties (#3093).
 * @defaultValue `{ level: 1 }`
 */
export declare const ENV: {
  get TRACE(): boolean;
  get NAME(): string;
  set NAME(value: string);
  /** @defaultValue 1 */
  level: number
};
export declare const createClient: (config?: {
  baseUrl?: string
  timeout?: number
}, retries?: number, name?: string, verbose?: boolean) => void;
/**
 * @defaultValue
 * ```ts
 * {
 *   resilient: (config?: {
 *     sentryDsn?: string
 *     bugsnagApiKey?: string
 *     services?: string[]
 *   }) => string,
 *   load: (options?: { cache?: boolean }, attempts?: number) => Promise<number>,
 *   configure: (config?: { host?: string; port?: number }) => void,
 *   withCallback: (count?: number, done?: () => void) => number
 * }
 * ```
 */
export declare const presets: {
  resilient: (config?: { sentryDsn?: string; bugsnagApiKey?: string; services?: string[] }) => string;
  load: (options?: { cache?: boolean }, attempts?: number) => Promise<number>;
  configure: (config?: {
    host?: string
    port?: number
  }) => void;
  withCallback: (count?: number, done?: () => void) => number
};
export declare const format: (value?: number, unit?: string) => string;
export declare class ErrorHandler {
  resilient(config?: { sentryDsn?: string, bugsnagApiKey?: string }): void;
}

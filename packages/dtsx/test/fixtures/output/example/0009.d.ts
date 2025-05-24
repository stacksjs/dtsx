import type { Config } from './types';
/**
 * Load Config
 *
 * @param {object} options - The configuration options.
 * @param {string} options.name - The name of the configuration file.
 * @param {string} [options.cwd] - The current working directory.
 * @param {string} [options.endpoint] - The API endpoint to fetch config from in browser environments.
 * @param {string} [options.headers] - The headers to send with the request in browser environments.
 * @param {T} options.defaultConfig - The default configuration.
 * @returns {Promise<T>} The merged configuration.
 * @example ```ts
 * // Merges arrays if both configs are arrays, otherwise does object deep merge
 * await loadConfig({
 *   name: 'example',
 *   endpoint: '/api/my-custom-config/endpoint',
 *   defaultConfig: [{ foo: 'bar' }]
 * })
 * ```
 */
export declare function loadConfig<T>({
  name,
  cwd,
  defaultConfig,
  endpoint,
  headers,
}: Config<T>): Promise<T>;
export * from './types';
export * from './utils';
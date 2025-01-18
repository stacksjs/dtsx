import type { Config } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { deepMerge } from './utils'

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
export async function loadConfig<T>({
  name,
  cwd,
  defaultConfig,
  endpoint,
  headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
}: Config<T>): Promise<T> {
  // If running in a server (Bun) environment, load the config from the file system
  if (typeof window === 'undefined') {
    // back 3 times to get out of node_modules into the root directory, assuming the config is in the root directory
    const configPath = resolve(cwd || '../../../', `${name}.config`)

    try {
      const importedConfig = await import(configPath)
      const loadedConfig = importedConfig.default || importedConfig
      return deepMerge(defaultConfig, loadedConfig) as T
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (error: any) {
      return defaultConfig
    }
  }

  if (!endpoint) {
    console.warn('An API endpoint is required to load the client config.')
    return defaultConfig
  }

  // If running in a browser environment, load the config from an API endpoint
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const loadedConfig = await response.json() as T
    return deepMerge(defaultConfig, loadedConfig) as T
  }
  catch (error) {
    console.error('Failed to load client config:', error)
    return defaultConfig
  }
}

export * from './types'
export * from './utils'

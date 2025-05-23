import { resolve } from 'node:path'
import process from 'node:process'
import { deepMerge } from './utils'

export interface ConfigOptions<T> {
  name: string
  cwd?: string
  defaultConfig: T
}

export async function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: ConfigOptions<T>): Promise<T> {
  const c = cwd ?? process.cwd()
  const configPath = resolve(c, `${name}.config`)

  try {
    const importedConfig = await import(configPath)
    const loadedConfig = importedConfig.default || importedConfig
    return deepMerge(defaultConfig, loadedConfig)
  }
  catch (error) {
    console.error(`Error loading config from ${configPath}:`, error)
    return defaultConfig
  }
}

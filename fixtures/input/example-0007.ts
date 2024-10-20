import type { DtsGenerationConfig } from '@stacksjs/dtsx'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { deepMerge } from '@stacksjs/dtsx'

interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}

export async function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: Options<T>): Promise<T> {
  const c = cwd ?? process.cwd()
  const configPath = resolve(c, `${name}.config`)

  if (existsSync(configPath)) {
    try {
      const importedConfig = await import(configPath)
      const loadedConfig = importedConfig.default || importedConfig
      return deepMerge(defaultConfig, loadedConfig)
    }
    catch (error) {
      console.error(`Error loading config from ${configPath}:`, error)
    }
  }

  return defaultConfig
}

// Get loaded config
// eslint-disable-next-line antfu/no-top-level-await
export const config: DtsGenerationConfig = await loadConfig({
  name: 'dts',
  cwd: process.cwd(),
  defaultConfig: {
    cwd: process.cwd(),
    root: './src',
    entrypoints: ['**/*.ts'],
    outdir: './dist',
    keepComments: true,
    clean: true,
    tsconfigPath: './tsconfig.json',
  },
})

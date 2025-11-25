import type { DtsGenerationConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'bunfig'

export const defaultConfig: DtsGenerationConfig = {
  cwd: process.cwd(),
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  tsconfigPath: './tsconfig.json',
  outputStructure: 'mirror',
  verbose: false,
}

// Get loaded config
// Lazy-loaded config to avoid top-level await (enables bun --compile)
let _config: DtsGenerationConfig | null = null

export async function getConfig(): Promise<DtsGenerationConfig> {
  if (!_config) {
    _config = await loadConfig({
  name: 'dts',
  defaultConfig,
})
  }
  return _config
}

// For backwards compatibility - synchronous access with default fallback
export const config: DtsGenerationConfig = defaultConfig

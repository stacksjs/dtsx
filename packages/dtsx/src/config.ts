import type { DtsGenerationConfig } from './types'
import process from 'node:process'
// @ts-expect-error current issue with bunfig and dtsx
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
// eslint-disable-next-line antfu/no-top-level-await
export const config: DtsGenerationConfig = await loadConfig({
  name: 'dts',
  defaultConfig,
})

import type { DtsGenerationConfig } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
// @ts-expect-error - types are missing for now
import { loadConfig } from 'bun-config'

// Get loaded config
// eslint-disable-next-line antfu/no-top-level-await
export const config: DtsGenerationConfig = await loadConfig({
  name: 'dts',
  defaultConfig: {
    cwd: process.cwd(),
    root: './src',
    entrypoints: ['**/*.ts'],
    outdir: './dist',
    keepComments: true,
    clean: true,
    tsconfigPath: './tsconfig.json',
    verbose: false,
  },
})

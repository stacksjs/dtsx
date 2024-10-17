import type { DtsGenerationConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'c12'

// Get loaded config
// eslint-disable-next-line antfu/no-top-level-await
export const config: DtsGenerationConfig = (await loadConfig({
  name: 'dts',
  defaultConfig: {
    cwd: process.cwd(),
    root: './src',
    file: '**/*.ts',
    outdir: './dist',
    keepComments: true,
    clean: true,
    tsconfigPath: './tsconfig.json',
  },
})).config

import process from 'node:process'
import { loadConfig } from 'c12'
import type { DtsGenerationConfig } from './types'

// Get loaded config
export const config: DtsGenerationConfig = (await loadConfig({
  name: 'dts',
  defaultConfig: {
    cwd: process.cwd(),
    root: './src',
    outdir: './dist',
    keepComments: true,
  },
})).config

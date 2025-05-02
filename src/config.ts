import type { DtsGenerationConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'bunfig'

// Get loaded config
// @ts-expect-error bunfig error due to current dtsx incompatibility (0009)
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
    outputStructure: 'mirror',
  },
})

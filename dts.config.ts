import type { DtsGenerationOption } from './packages/dtsx/src/types'

const config: DtsGenerationOption = {
  cwd: __dirname,
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  clean: true,
  verbose: false,

  // keepComments: true,
  // bundle: true,
  // minify: true,
}

export default config

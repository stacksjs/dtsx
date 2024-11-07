import type { DtsGenerationOption } from './src/types'

const config: DtsGenerationOption = {
  cwd: './',
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

import type { DtsGenerationOption } from './src/types'

const config: DtsGenerationOption = {
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  verbose: false,

  // bundle: true,
  // minify: true,
}

export default config

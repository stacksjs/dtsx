import type { DtsGenerationOption } from './src/types'

const config: DtsGenerationOption = {
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,

  // bundle: true,
  // minify: true,
}

export default config

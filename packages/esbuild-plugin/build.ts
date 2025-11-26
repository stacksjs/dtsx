import { build } from 'esbuild'
import { generate } from '@stacksjs/dtsx'

console.log('Building...')

const result = await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['@stacksjs/dtsx', 'esbuild'],
  target: 'node18',
})

// Generate declaration files
await generate({
  cwd: process.cwd(),
  root: './src',
  outdir: './dist',
  entrypoints: ['index.ts'],
})

console.log('Build complete')

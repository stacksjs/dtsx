import { generate } from '@dtsx/dtsx'
import { build } from 'esbuild'

console.log('Building...')

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['@dtsx/dtsx', 'esbuild'],
  target: 'node18',
})

// Generate declaration files
await generate({
  cwd: process.cwd(),
  root: './src',
  outdir: './dist',
  entrypoints: ['index.ts'],
  moduleSpecifierMode: 'node',
})

console.log('Build complete')

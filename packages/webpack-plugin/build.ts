import { generate } from '@stacksjs/dtsx'

console.log('Building...')

const result = await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'node',
  external: ['@stacksjs/dtsx', 'webpack'],
  format: 'esm',
})

if (!result.success) {
  console.error('Build failed')
  for (const message of result.logs) {
    console.error(message)
  }
  process.exit(1)
}

// Generate declaration files
await generate({
  cwd: process.cwd(),
  root: './src',
  outdir: './dist',
  entrypoints: ['index.ts'],
})

console.log('Build complete')

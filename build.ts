import fs from 'node:fs/promises'
import { log } from '@stacksjs/cli'
import { dts } from 'bun-plugin-dtsx'

log.info('Building...')

await fs.rm('./dist', { recursive: true, force: true })

await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: true,
  plugins: [
    dts(),
  ],
})

// prepare dist for publishing
await fs.rename('./dist/bin/cli.js', './dist/cli.js')
await fs.rename('./dist/src/index.js', './dist/index.js')
await fs.rm('./dist/src', { recursive: true, force: true })
await fs.rm('./dist/bin', { recursive: true, force: true })

log.success('Built')

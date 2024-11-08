import { log } from '@stacksjs/cli'
import { fs } from '@stacksjs/storage'
import { dts } from 'bun-plugin-dtsx'

log.info('Building...')

await fs.rm('./dist', { recursive: true, force: true })

await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: true,
  plugins: [dts()],
})

// prepare dist for publishing
await fs.move('./dist/bin/cli.js', './dist/cli.js')
await fs.move('./dist/src/index.js', './dist/index.js')
await fs.remove('./dist/src')
await fs.remove('./dist/bin')

log.success('Built')

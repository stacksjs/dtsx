import fs from 'node:fs/promises'
import dts from 'bun-plugin-dtsx'

console.log('Building...')

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

console.log('Built!')

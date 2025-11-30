import fs from 'node:fs/promises'
import dts from 'bun-plugin-dtsx'

console.log('Building...')

await fs.rm('./dist', { recursive: true, force: true })

await Bun.build({
  entrypoints: [
    './src/index.ts',
    './bin/cli.ts',
    './src/plugins/vite.ts',
    './src/plugins/bun.ts',
    './src/plugins/esbuild.ts',
    './src/plugins/tsup.ts',
    './src/plugins/webpack.ts',
    './src/plugins/index.ts',
  ],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: true,
  splitting: true,
  plugins: [
    dts(),
  ],
})

console.log('Built!')

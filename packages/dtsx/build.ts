import fs from 'node:fs/promises'
import dts from 'bun-plugin-dtsx'

console.log('Building...')

await fs.rm('./dist', { recursive: true, force: true })

const sourceEntrypoints = await Array.fromAsync(new Bun.Glob('./src/*.ts').scan())
const runtimeEntrypoints = sourceEntrypoints.filter(entrypoint => entrypoint !== './src/checker.ts')

await Bun.build({
  entrypoints: [
    ...runtimeEntrypoints,
    './bin/cli.ts',
    './src/plugins/vite.ts',
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

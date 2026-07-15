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

// Ensure the bin is directly executable (npm marks it executable when it
// begins with a shebang; Bun's bundler does not emit one).
const cliPath = './dist/bin/cli.js'
const cli = await Bun.file(cliPath).text()
if (!cli.startsWith('#!'))
  await Bun.write(cliPath, `#!/usr/bin/env bun\n${cli}`)

console.log('Built!')

import process from 'node:process'
import dts from 'bun-plugin-dtsx'

console.log('Building...')

const result = await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'bun',
  external: ['@stacksjs/dtsx'],
  // minify: true,
  plugins: [dts()],
})

if (!result.success) {
  console.error('Build failed')

  for (const message of result.logs) {
    console.error(message)
  }

  process.exit(1)
}

console.log('Build complete')

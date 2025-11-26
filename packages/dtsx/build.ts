import fs from 'node:fs/promises'
import dts from 'bun-plugin-dtsx'

console.log('Building...')

await fs.rm('./dist', { recursive: true, force: true })

// Build ESM version
console.log('Building ESM...')
await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist/esm',
  format: 'esm',
  target: 'bun',
  minify: true,
  splitting: true,
  plugins: [
    dts(),
  ],
})

// Build CommonJS version
console.log('Building CommonJS...')
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist/cjs',
  format: 'cjs',
  target: 'node',
  minify: true,
  splitting: false,
  naming: '[dir]/[name].cjs',
})

// Copy ESM bin to dist root for backwards compatibility
await fs.cp('./dist/esm/bin', './dist/bin', { recursive: true })
await fs.cp('./dist/esm/src', './dist/src', { recursive: true })
await fs.cp('./dist/esm/index.d.ts', './dist/index.d.ts')

// Create package.json for CJS directory to mark it as CommonJS
await fs.writeFile('./dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2))

console.log('Built!')

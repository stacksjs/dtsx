import { log } from '@stacksjs/cli'
import { fs } from '@stacksjs/storage'
import { generateDeclarationsFromFiles } from './src/generate'

log.info('Building...')

await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
})

try {
  await generateDeclarationsFromFiles()
  console.log('Generated declarations')
}
catch (error) {
  console.error('Error generating declarations:', error)
}

// prepare dist for publishing
await fs.move('./dist/bin/cli.js', './dist/cli.js')
await fs.move('./dist/src/index.js', './dist/index.js')
await fs.remove('./dist/src')
await fs.remove('./dist/bin')

log.success('Built')

import { log } from '@stacksjs/cli'
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
} catch (error) {
  console.error('Error generating declarations:', error)
}

log.success('Built')

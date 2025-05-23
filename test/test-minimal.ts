import { processFile } from '../src/generator'
import { resolve } from 'node:path'

const testFilePath = resolve(import.meta.dir, '..', 'fixtures/input/variable.ts')

console.log('Processing variable.ts...')
const result = await processFile(testFilePath, {
  cwd: process.cwd(),
  root: './fixtures/input',
  entrypoints: ['*.ts'],
  outdir: './test/output',
  keepComments: true,
  clean: true,
  tsconfigPath: './tsconfig.json',
  outputStructure: 'flat',
  verbose: false
})

console.log('Generated DTS:')
console.log('='.repeat(80))
console.log(result.substring(0, 1000))
console.log('='.repeat(80))
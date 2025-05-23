import { generate } from '../src/generator'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function testFixtures() {
  console.log('Testing DTS generation with fixtures...\n')

  // Generate DTS for fixture files
  await generate({
    cwd: resolve(import.meta.dir, '..'),
    root: './fixtures/input',
    entrypoints: ['*.ts'],
    outdir: './test/output',
    outputStructure: 'flat',
    verbose: true
  })

  // Compare specific outputs
  const files = ['function.d.ts', 'variable.d.ts', 'interface.d.ts', 'type.d.ts']

  for (const file of files) {
    try {
      console.log(`\n=== ${file} ===`)
      const generated = await readFile(resolve(import.meta.dir, 'output', file), 'utf-8')
      console.log(generated.substring(0, 500) + (generated.length > 500 ? '\n...' : ''))
    } catch (error) {
      console.log(`File not generated yet: ${file}`)
    }
  }
}

testFixtures().catch(console.error)
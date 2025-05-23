import { extractDeclarations } from '../src/extractor'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const testFilePath = resolve(import.meta.dir, '..', 'fixtures/input/variable.ts')
const sourceCode = await readFile(testFilePath, 'utf-8')

console.log('Extracting declarations from variable.ts...')
const declarations = extractDeclarations(sourceCode, testFilePath)

console.log(`\nFound ${declarations.length} declarations:`)
for (const decl of declarations) {
  console.log(`- ${decl.kind}: ${decl.name} (exported: ${decl.isExported})`)
  if (decl.kind === 'variable' && decl.name === 'conf') {
    console.log(`  Text length: ${decl.text.length}`)
    console.log(`  First 100 chars: ${decl.text.substring(0, 100)}...`)
  }
}
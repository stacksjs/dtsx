import { extractDeclarations } from './src/extractor'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const filePath = join(__dirname, 'test/fixtures/input/example/0002.ts')
const sourceCode = await readFile(filePath, 'utf-8')

console.log('Source code:')
console.log(sourceCode)
console.log('\n' + '='.repeat(50) + '\n')

const declarations = extractDeclarations(sourceCode, filePath)

console.log('Extracted declarations:')
declarations.forEach((decl, index) => {
  console.log(`${index + 1}. Kind: ${decl.kind}`)
  console.log(`   Name: ${decl.name}`)
  console.log(`   Text: ${decl.text}`)
  console.log(`   IsExported: ${decl.isExported}`)
  console.log(`   IsTypeOnly: ${decl.isTypeOnly}`)
  console.log('   ---')
})
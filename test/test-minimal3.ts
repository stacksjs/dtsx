import { extractFunctions, extractVariables, extractImports } from '../src/extractor'

const testCode = `
import process from 'node:process'
import type { Config } from './config'

export const VERSION = '1.0.0'

export function test() {
  return 'test'
}
`

console.log('Testing individual extractors...\n')

console.log('Functions:')
const functions = extractFunctions(testCode)
console.log(`Found ${functions.length}:`, functions.map(f => f.name))

console.log('\nVariables:')
const variables = extractVariables(testCode)
console.log(`Found ${variables.length}:`, variables.map(v => v.name))

console.log('\nImports:')
const imports = extractImports(testCode)
console.log(`Found ${imports.length}`)
for (const imp of imports) {
  console.log(`- Type only: ${imp.isTypeOnly}`)
  console.log(`- Text: "${imp.text}"`)
  console.log('---')
}
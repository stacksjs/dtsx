import { extractVariables } from '../src/extractor'
import { processVariableDeclaration } from '../src/processor'

const testCode = `
export const stringLiteral = 'Hello World'
export const numberLiteral = 42
export const booleanLiteral = true
`

console.log('Testing variable extraction...')
const declarations = extractVariables(testCode)
console.log(`Found ${declarations.length} variables:`)

for (const decl of declarations) {
  console.log(`\nVariable: ${decl.name}`)
  console.log(`Kind: ${decl.modifiers?.[0]}`)
  console.log(`Value: ${decl.value}`)
  console.log(`Type annotation: ${decl.typeAnnotation}`)

  const processed = processVariableDeclaration(decl)
  console.log(`Generated: ${processed}`)
}
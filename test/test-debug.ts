import { extractDeclarations } from '../src/extractor'

const testCode = `
import type { Config } from './config'

export interface User {
  id: string
  name: string
}

export function getUser(id: string): User {
  return { id, name: 'John' }
}

export const VERSION = '1.0.0'
`

console.log('Extracting declarations from test code...')
const declarations = extractDeclarations(testCode, 'test.ts')

console.log(`\nFound ${declarations.length} declarations:`)
for (const decl of declarations) {
  console.log(`- ${decl.kind}: ${decl.name} (exported: ${decl.isExported})`)
}

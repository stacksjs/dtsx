import { extractDeclarations } from '../src/extractor'
import type { DtsGenerationOption } from '../src/types'
import { join } from 'node:path'
import { generate } from '../src/generator'

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

async function debugTest() {
  const testDir = join(__dirname, 'fixtures')
  const inputDir = join(testDir, 'input')
  const generatedDir = join(testDir, 'generated')

  const config: DtsGenerationOption = {
    entrypoints: [join(inputDir, 'variable.ts')],
    outdir: generatedDir,
    clean: false,
    tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    outputStructure: 'flat',
    verbose: true,
    cwd: process.cwd(),
    root: '.',
  }

  console.log('Config:', config)
  console.log('Input file exists:', await Bun.file(join(inputDir, 'variable.ts')).exists())

  try {
    await generate(config)
    console.log('Generation completed successfully')

    const generatedPath = join(generatedDir, 'variable.d.ts')
    console.log('Generated file exists:', await Bun.file(generatedPath).exists())

    if (await Bun.file(generatedPath).exists()) {
      const content = await Bun.file(generatedPath).text()
      console.log('Generated content length:', content.length)
      console.log('Generated content preview:', content.substring(0, 200))
    }
  } catch (error) {
    console.error('Generation failed:', error)
  }
}

debugTest()

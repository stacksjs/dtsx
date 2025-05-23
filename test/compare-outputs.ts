import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function compareOutputs() {
  const files = ['function.d.ts', 'variable.d.ts', 'interface.d.ts', 'type.d.ts', 'class.d.ts']

  for (const file of files) {
    console.log(`\n=== Comparing ${file} ===`)

    try {
      const expected = await readFile(resolve(import.meta.dir, '..', 'fixtures/output', file), 'utf-8')
      const generated = await readFile(resolve(import.meta.dir, 'output', file), 'utf-8')

      if (expected === generated) {
        console.log('✅ EXACT MATCH!')
      } else {
        console.log('❌ DIFFERENCES FOUND')

        // Show first difference
        const expectedLines = expected.split('\n')
        const generatedLines = generated.split('\n')

        for (let i = 0; i < Math.max(expectedLines.length, generatedLines.length); i++) {
          if (expectedLines[i] !== generatedLines[i]) {
            console.log(`\nFirst difference at line ${i + 1}:`)
            console.log(`Expected:  "${expectedLines[i] || '(empty)'}"`)
            console.log(`Generated: "${generatedLines[i] || '(empty)'}"`)
            break
          }
        }
      }
    } catch (error: any) {
      console.log(`❌ Error comparing: ${error.message}`)
    }
  }
}

compareOutputs().catch(console.error)

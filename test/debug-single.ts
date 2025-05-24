import type { DtsGenerationOption } from '../src/types'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generate } from '../src/generator'

async function debugSingle() {
  const testDir = join(__dirname, 'fixtures')
  const inputDir = join(testDir, 'input')
  const generatedDir = join(testDir, 'generated')

  const config: DtsGenerationOption = {
    entrypoints: [join(inputDir, 'variable.ts')],
    outdir: generatedDir,
    clean: false,
    tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    outputStructure: 'flat',
    verbose: false,
    cwd: process.cwd(),
    root: '.',
  }

  await generate(config)

  const generatedPath = join(generatedDir, 'variable.d.ts')
  const outputPath = join(testDir, 'output', 'variable.d.ts')

  const generatedContent = await Bun.file(generatedPath).text()
  const expectedContent = await Bun.file(outputPath).text()

  // Save both for comparison
  await writeFile('generated-variable.d.ts', generatedContent)
  await writeFile('expected-variable.d.ts', expectedContent)

  console.log('Files saved for comparison:')
  console.log('- generated-variable.d.ts')
  console.log('- expected-variable.d.ts')
}

debugSingle()

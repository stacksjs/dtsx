import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { generate } from '../src/generate'
import type { DtsGenerationConfig } from '../src/types'

describe('dts-generation', () => {
  const cwdDir = join(__dirname, '..')
  const inputDir = join(cwdDir, 'fixtures/input')
  const outputDir = join(cwdDir, 'fixtures/output')

  const config: DtsGenerationConfig = {
    cwd: cwdDir,
    root: inputDir,
    outdir: outputDir,
    keepComments: true,
    clean: false,
    tsconfigPath: join(cwdDir, 'tsconfig.json'),
  }

  it('should generate correct type declarations for all input files', async () => {
    // Generate the declaration files
    await generate(config)

    // Get all input files
    const inputFiles = await readdir(inputDir)

    for (const file of inputFiles) {
      const outputPath = join(outputDir, file.replace('.ts', '.d.ts'))
      const generatedPath = join(outputDir, file.replace('.ts', '.d.ts'))

      // Read expected and generated content
      const expectedContent = await Bun.file(outputPath).text()
      const generatedContent = await Bun.file(generatedPath).text()

      // Compare the contents
      expect(generatedContent.trim()).toBe(expectedContent.trim())
    }
  })
})

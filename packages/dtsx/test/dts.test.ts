import type { DtsGenerationOption } from '../src/types'
import { afterEach, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { generate } from '../src/generator'

describe('dts-generation', () => {
  const testDir = join(__dirname, 'fixtures')
  const inputDir = join(testDir, 'input')
  const outputDir = join(testDir, 'output')
  const generatedDir = join(testDir, 'generated')

  // List of all example files to test
  const examples = [
    '0001',
    '0002',
    '0003',
    '0004',
    '0005',
    '0006',
    '0007',
    '0008',
    '0009',
    '0010',
    '0011',
  ]

  // List of all fixture files to test (excluding checker.ts which is too large)
  const fixtures = [
    'abseil.io',
    'class',
    'edge-cases',
    'enum',
    'exports',
    'function',
    'function-types',
    'imports',
    'interface',
    'module',
    'namespace',
    'type',
    'type-interface-imports',
    'variable',
  ]

  // Generate a test for each example file
  examples.forEach((example) => {
    it(`should properly generate types for example ${example}`, async () => {
      const config: DtsGenerationOption = {
        entrypoints: [join(inputDir, 'example', `${example}.ts`)],
        outdir: generatedDir,
        clean: false,
        tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
        outputStructure: 'flat',
      }

      await generate(config)

      const outputPath = join(outputDir, 'example', `${example}.d.ts`)
      const generatedPath = join(generatedDir, `${example}.d.ts`)

      const expectedContent = await Bun.file(outputPath).text()
      const generatedContent = await Bun.file(generatedPath).text()

      expect(generatedContent).toBe(expectedContent)
    })
  })

  // Generate a test for each fixture file
  fixtures.forEach((fixture) => {
    it(`should properly generate types for fixture ${fixture}`, async () => {
      const config: DtsGenerationOption = {
        entrypoints: [join(inputDir, `${fixture}.ts`)],
        outdir: generatedDir,
        clean: false,
        tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
        outputStructure: 'flat',
      }

      await generate(config)

      const outputPath = join(outputDir, `${fixture}.d.ts`)
      const generatedPath = join(generatedDir, `${fixture}.d.ts`)

      const expectedContent = await Bun.file(outputPath).text()
      const generatedContent = await Bun.file(generatedPath).text()

      expect(generatedContent).toBe(expectedContent)
    })
  })

  afterEach(async () => {
    // Clean up generated files
    try {
      await rm(generatedDir, { recursive: true, force: true })
    }
    catch (error) {
      console.error('Error cleaning up generated files:', error)
    }
  })
})

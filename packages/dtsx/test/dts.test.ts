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
    '0012',
  ]

  // List of all fixture files to test
  const fixtures = [
    'abseil.io',
    'advanced-types',
    'class',
    'comments',
    'complex-class',
    'edge-cases',
    'enum',
    'exports',
    'function',
    'function-types',
    'generics',
    'imports',
    'interface',
    'mixed-exports',
    'module',
    'namespace',
    'private-members',
    'ts-features',
    'type',
    'type-interface-imports',
    'variable',
  ]

  // Large fixture files (slower tests)
  const largeFixtures = [
    'checker',
  ]

  /**
   * Shared fixture test runner: generates DTS and compares to expected output
   */
  async function runFixtureTest(name: string, inputSubdir?: string, timeout?: number): Promise<void> {
    const entrypoint = inputSubdir
      ? join(inputDir, inputSubdir, `${name}.ts`)
      : join(inputDir, `${name}.ts`)

    const config: DtsGenerationOption = {
      entrypoints: [entrypoint],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat',
    }

    await generate(config)

    const expectedPath = inputSubdir
      ? join(outputDir, inputSubdir, `${name}.d.ts`)
      : join(outputDir, `${name}.d.ts`)
    const generatedPath = join(generatedDir, `${name}.d.ts`)

    const expectedContent = await Bun.file(expectedPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  }

  // Generate a test for each example file
  examples.forEach((example) => {
    it(`should properly generate types for example ${example}`, () => runFixtureTest(example, 'example'))
  })

  // Generate a test for each fixture file
  fixtures.forEach((fixture) => {
    it(`should properly generate types for fixture ${fixture}`, () => runFixtureTest(fixture))
  })

  // Generate a test for each large fixture file (slower tests)
  largeFixtures.forEach((fixture) => {
    it(`should properly generate types for large fixture ${fixture}`, () => runFixtureTest(fixture), 30000)
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

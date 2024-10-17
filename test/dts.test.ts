import { describe, it, expect, afterEach } from 'bun:test'
import { join } from 'node:path'
import { generate } from '../src/generate'
import type { DtsGenerationOption } from '../src/types'
import { rm } from 'node:fs/promises'

describe('dts-generation', () => {
  const testDir = join(__dirname, '../fixtures')
  const inputDir = join(testDir, 'input')
  const outputDir = join(testDir, 'output')
  const generatedDir = join(testDir, 'generated')

  it('should properly generate types for example-1', async () => {
    const config: DtsGenerationOption = {
      file: join(__dirname, '..', 'tsconfig.json'),
      outdir: generatedDir,
      clean: true,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    await generate(config)

    const example = 'example-1'
    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)

  })

  it('should properly generate types for example-2', async () => {
    await testExample('example-2')
  })

  it('should properly generate types for example-3', async () => {
    await testExample('example-3')
  })

  it('should properly generate types for example-4', async () => {
    await testExample('example-4')
  })

  it('should properly generate types for example-5', async () => {
    await testExample('example-5')
  })

  afterEach(async () => {
    // Clean up generated files
    try {
      await rm(generatedDir, { recursive: true, force: true })
      console.log('Cleaned up generated files')
    } catch (error) {
      console.error('Error cleaning up generated files:', error)
    }
  })
})

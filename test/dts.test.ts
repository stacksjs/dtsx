import type { DtsGenerationOption } from '../src/types'
import { afterEach, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { generate } from '../src/generate'

describe('dts-generation', () => {
  const testDir = join(__dirname, '../fixtures')
  const inputDir = join(testDir, 'input')
  const outputDir = join(testDir, 'output')
  const generatedDir = join(testDir, 'generated')

  it('should properly generate types for example-1', async () => {
    const example = 'example-1'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for example-2', async () => {
    const example = 'example-2'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for example-3', async () => {
    const example = 'example-3'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for example-4', async () => {
    const example = 'example-4'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for example-5', async () => {
    const example = 'example-5'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
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

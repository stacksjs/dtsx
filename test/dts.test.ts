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

  it('should properly generate types for variable example', async () => {
    const example = 'variable'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat',
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for class example', async () => {
    const example = 'class'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat',
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for enum example', async () => {
    const example = 'enum'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat',
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for exports example', async () => {
    const example = 'exports'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for function example', async () => {
    const example = 'function'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for interface example', async () => {
    const example = 'interface'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for type example', async () => {
    const example = 'type'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for type example/0001', async () => {
    const example = '0001'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `example/${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for type example/0002', async () => {
    const example = '0002'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `example/${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for type example/0003', async () => {
    const example = '0003'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `example/${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for type example/0004', async () => {
    const example = '0004'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `example/${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
    }

    await generate(config)

    const outputPath = join(outputDir, `${example}.d.ts`)
    const generatedPath = join(generatedDir, `${example}.d.ts`)

    const expectedContent = await Bun.file(outputPath).text()
    const generatedContent = await Bun.file(generatedPath).text()

    expect(generatedContent).toBe(expectedContent)
  })

  it('should properly generate types for type example/0005', async () => {
    const example = '0005'

    const config: DtsGenerationOption = {
      entrypoints: [join(inputDir, `example/${example}.ts`)],
      outdir: generatedDir,
      clean: false,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      outputStructure: 'flat'
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

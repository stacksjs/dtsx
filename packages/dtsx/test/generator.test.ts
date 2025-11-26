import type { DtsGenerationConfig } from '../src/types'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generate, processSource } from '../src/generator'

describe('processSource (stdin support)', () => {
  it('should process simple variable declaration', () => {
    const source = `export const foo: string = 'bar';`
    const result = processSource(source)
    expect(result).toContain('export declare const foo: string;')
  })

  it('should process function declaration', () => {
    const source = `export function greet(name: string): string { return \`Hello, \${name}\`; }`
    const result = processSource(source)
    expect(result).toContain('export declare function greet(name: string): string;')
  })

  it('should process interface declaration', () => {
    const source = `export interface User { name: string; age: number; }`
    const result = processSource(source)
    expect(result).toContain('export declare interface User')
    expect(result).toContain('name: string')
    expect(result).toContain('age: number')
  })

  it('should process type alias', () => {
    const source = `export type ID = string | number;`
    const result = processSource(source)
    expect(result).toContain('export type ID = string | number')
  })

  it('should process class declaration', () => {
    const source = `export class MyClass {
      private name: string;
      constructor(name: string) { this.name = name; }
      getName(): string { return this.name; }
    }`
    const result = processSource(source)
    expect(result).toContain('export declare class MyClass')
    expect(result).toContain('private name: string;')
    expect(result).toContain('constructor(name: string);')
    expect(result).toContain('getName(): string;')
  })

  it('should process enum declaration', () => {
    const source = `export enum Status { Active, Inactive, Pending }`
    const result = processSource(source)
    expect(result).toContain('export declare enum Status')
    expect(result).toContain('Active')
    expect(result).toContain('Inactive')
    expect(result).toContain('Pending')
  })

  it('should handle imports and filter unused ones', () => {
    const source = `
      import { Used, Unused } from 'some-module';
      export function test(arg: Used): void {}
    `
    const result = processSource(source)
    expect(result).toContain('Used')
    expect(result).not.toContain('Unused')
  })

  it('should respect keepComments option', () => {
    const source = `
      /** This is a JSDoc comment */
      export function documented(): void {}
    `
    const resultWithComments = processSource(source, 'test.ts', true)
    expect(resultWithComments).toContain('JSDoc comment')

    const resultWithoutComments = processSource(source, 'test.ts', false)
    expect(resultWithoutComments).not.toContain('JSDoc comment')
  })

  it('should handle satisfies operator', () => {
    const source = `export const config = { port: 3000 } satisfies { port: number };`
    const result = processSource(source)
    expect(result).toContain('export declare const config: { port: number };')
  })

  it('should handle const type parameters', () => {
    const source = `export function createArray<const T extends readonly unknown[]>(items: T): T { return items; }`
    const result = processSource(source)
    expect(result).toContain('<const T extends readonly unknown[]>')
  })

  it('should handle mapped type modifiers', () => {
    const source = `export type MyReadonly<T> = { +readonly [K in keyof T]: T[K]; };`
    const result = processSource(source)
    expect(result).toContain('+readonly')
  })
})

describe('generate with parallel processing', () => {
  const tempDir = join(__dirname, 'temp-parallel-test')
  const inputDir = join(tempDir, 'input')
  const outputDir = join(tempDir, 'output')

  async function setupTestFiles() {
    await mkdir(inputDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })

    // Create test files
    await writeFile(join(inputDir, 'file1.ts'), `export const a: string = 'a';`)
    await writeFile(join(inputDir, 'file2.ts'), `export const b: number = 1;`)
    await writeFile(join(inputDir, 'file3.ts'), `export const c: boolean = true;`)
  }

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  it('should process files in parallel mode', async () => {
    await setupTestFiles()

    const config: DtsGenerationConfig = {
      cwd: tempDir,
      root: 'input',
      entrypoints: ['**/*.ts'],
      outdir: outputDir,
      clean: false,
      keepComments: true,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      parallel: true,
      concurrency: 2,
    }

    const stats = await generate(config)

    expect(stats.filesProcessed).toBe(3)
    expect(stats.filesGenerated).toBe(3)
    expect(stats.filesFailed).toBe(0)

    // Verify output files exist and have correct content
    const file1Content = await Bun.file(join(outputDir, 'file1.d.ts')).text()
    const file2Content = await Bun.file(join(outputDir, 'file2.d.ts')).text()
    const file3Content = await Bun.file(join(outputDir, 'file3.d.ts')).text()

    expect(file1Content).toContain('export declare const a: string;')
    expect(file2Content).toContain('export declare const b: number;')
    expect(file3Content).toContain('export declare const c: boolean;')
  })

  it('should produce same results in sequential and parallel mode', async () => {
    await setupTestFiles()

    const baseConfig: DtsGenerationConfig = {
      cwd: tempDir,
      root: 'input',
      entrypoints: ['**/*.ts'],
      outdir: outputDir,
      clean: false,
      keepComments: true,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
    }

    // Run sequential
    const sequentialConfig = { ...baseConfig, parallel: false }
    await generate(sequentialConfig)

    const seqFile1 = await Bun.file(join(outputDir, 'file1.d.ts')).text()
    const seqFile2 = await Bun.file(join(outputDir, 'file2.d.ts')).text()
    const seqFile3 = await Bun.file(join(outputDir, 'file3.d.ts')).text()

    // Clean and run parallel
    await rm(outputDir, { recursive: true, force: true })
    await mkdir(outputDir, { recursive: true })

    const parallelConfig = { ...baseConfig, parallel: true, concurrency: 2 }
    await generate(parallelConfig)

    const parFile1 = await Bun.file(join(outputDir, 'file1.d.ts')).text()
    const parFile2 = await Bun.file(join(outputDir, 'file2.d.ts')).text()
    const parFile3 = await Bun.file(join(outputDir, 'file3.d.ts')).text()

    expect(parFile1).toBe(seqFile1)
    expect(parFile2).toBe(seqFile2)
    expect(parFile3).toBe(seqFile3)
  })

  it('should handle errors gracefully with continueOnError in parallel mode', async () => {
    await setupTestFiles()
    // Create a file with syntax error
    await writeFile(join(inputDir, 'error.ts'), `export const invalid: = ;`)

    const config: DtsGenerationConfig = {
      cwd: tempDir,
      root: 'input',
      entrypoints: ['**/*.ts'],
      outdir: outputDir,
      clean: false,
      keepComments: true,
      tsconfigPath: join(__dirname, '..', 'tsconfig.json'),
      parallel: true,
      concurrency: 2,
      continueOnError: true,
    }

    const stats = await generate(config)

    // Should process all files, with some failing
    expect(stats.filesProcessed).toBe(4)
    expect(stats.filesGenerated).toBeGreaterThanOrEqual(3)
  })
})

describe('edge cases', () => {
  it('should handle empty source', () => {
    const result = processSource('')
    expect(result).toBe('')
  })

  it('should handle source with only comments', () => {
    const source = `// Just a comment\n/* Block comment */`
    const result = processSource(source)
    expect(result).toBe('')
  })

  it('should handle source with only imports', () => {
    const source = `import { something } from 'somewhere';`
    const result = processSource(source)
    // Unused imports should be filtered out
    expect(result).toBe('')
  })

  it('should handle complex generic types', () => {
    const source = `
      export type DeepPartial<T> = T extends object
        ? { [P in keyof T]?: DeepPartial<T[P]> }
        : T;
    `
    const result = processSource(source)
    expect(result).toContain('DeepPartial')
    expect(result).toContain('keyof T')
  })

  it('should handle function overloads', () => {
    const source = `
      export function process(value: string): string;
      export function process(value: number): number;
      export function process(value: string | number): string | number {
        return value;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function process(value: string): string;')
    expect(result).toContain('export declare function process(value: number): number;')
  })

  it('should handle async generators', () => {
    const source = `export async function* asyncGen(): AsyncGenerator<number> { yield 1; }`
    const result = processSource(source)
    expect(result).toContain('export declare function asyncGen(): AsyncGenerator<number>;')
  })

  it('should handle accessor declarations', () => {
    const source = `
      export class WithAccessors {
        #value: number = 0;
        get value(): number { return this.#value; }
        set value(v: number) { this.#value = v; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('get value(): number;')
    expect(result).toContain('set value(v: number);')
  })

  it('should handle abstract classes', () => {
    const source = `
      export abstract class AbstractBase {
        abstract getValue(): string;
        concrete(): number { return 42; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare abstract class AbstractBase')
    expect(result).toContain('abstract getValue(): string;')
    expect(result).toContain('concrete(): number;')
  })

  it('should handle namespace declarations', () => {
    const source = `
      export namespace MyNamespace {
        export interface Config { debug: boolean; }
        export function init(): void {}
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare namespace MyNamespace')
    expect(result).toContain('export interface Config')
    expect(result).toContain('export function init(): void;')
  })

  it('should handle re-exports', () => {
    const source = `
      export { foo, bar as baz } from './other';
      export * from './all';
      export * as utils from './utils';
    `
    const result = processSource(source)
    expect(result).toContain("export { foo, bar as baz } from './other';")
    expect(result).toContain("export * from './all';")
    expect(result).toContain("export * as utils from './utils';")
  })

  it('should handle default exports', () => {
    const source = `
      const value = 42;
      export default value;
    `
    const result = processSource(source)
    expect(result).toContain('export default value;')
  })

  it('should handle triple-slash directives', () => {
    const source = `/// <reference types="node" />\nexport const x: number = 1;`
    const result = processSource(source)
    expect(result).toContain('/// <reference types="node" />')
  })

  it('should handle declare const enum', () => {
    const source = `export const enum Direction { Up, Down, Left, Right }`
    const result = processSource(source)
    expect(result).toContain('export declare const enum Direction')
  })
})

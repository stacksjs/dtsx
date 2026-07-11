import { afterEach, describe, expect, it } from 'bun:test'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractDeclarations } from '../src/extractor'
import { generate } from '../src/generator'
import { clearResultCache, processSource, processSourceIsolated, processSourceSemantic } from '../src/process-source'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('declaration generation paths', () => {
  it('treats concrete annotations as authoritative in isolated mode', () => {
    const source = `export const value: string = createVeryExpensiveValue({ answer: 'yes' });`

    const result = processSourceIsolated(source, 'isolated.ts')

    expect(result).toContain('export declare const value: string;')
    expect(result).not.toContain('answer:')
  })

  it('does not retain annotated initializers in isolated mode', () => {
    const source = `
      export const values: readonly string[] = createVeryExpensiveValue({
        deeply: { nested: ['implementation', 'details'] },
      });
    `

    const [declaration] = extractDeclarations(source, 'isolated.ts', true, true)

    expect(declaration.typeAnnotation).toBe('readonly string[]')
    expect(declaration.value).toBeUndefined()
  })

  it('preserves broad contracts and documents their initializer values', () => {
    const source = `
      export const conf: { [key: string]: string } = {
        apiUrl: 'https://api.stacksjs.org',
        timeout: '5000',
      };
    `

    const result = processSourceIsolated(source, 'config.ts')

    expect(result).toContain("@defaultValue `{ apiUrl: 'https://api.stacksjs.org', timeout: '5000' }`")
    expect(result).toContain('export declare const conf: { [key: string]: string };')
  })

  it('documents as-const records without losing their indexable contract', () => {
    const source = `
      export const PHONE_PATTERNS: Record<string, number[]> = {
        US: [3, 3, 4],
        GB: [4, 3, 3],
      } as const;
    `

    const result = processSourceIsolated(source, 'phone.ts')

    expect(result).toContain('@defaultValue')
    expect(result).toContain('US: [3, 3, 4]')
    expect(result).toContain('GB: [4, 3, 3]')
    expect(result).toContain('export declare const PHONE_PATTERNS: Record<string, number[]>;')
  })

  it('retains initializers for inference in semantic mode', () => {
    const source = `export const values = ['one', 'two'];`

    const [declaration] = extractDeclarations(source, 'semantic.ts', true, false)
    const result = processSourceSemantic(source, 'semantic.ts')

    expect(declaration.value).toBe("['one', 'two']")
    expect(result).toContain('export declare const values: string[];')
  })

  it('keeps result caches separate across import orders', () => {
    clearResultCache()
    const source = `
      import type { BunType } from 'bun';
      import type { NodeType } from 'node:fs';
      export interface Result { bun: BunType; node: NodeType }
    `

    const bunFirst = processSource(source, 'order.ts', true, ['bun'])
    const nodeFirst = processSource(source, 'order.ts', true, ['node:'])

    expect(bunFirst.indexOf("from 'bun'")).toBeLessThan(bunFirst.indexOf("from 'node:fs'"))
    expect(nodeFirst.indexOf("from 'node:fs'")).toBeLessThan(nodeFirst.indexOf("from 'bun'"))
  })

  it('routes project generation through the configured path', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-generation-paths-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const values: Record<string, string> = { answer: 'yes' };`)

    const sharedConfig = {
      cwd,
      root: 'src',
      entrypoints: ['index.ts'],
      keepComments: true,
      clean: true,
    }
    const isolatedStats = await generate({
      ...sharedConfig,
      outdir: 'dist-isolated',
      isolatedDeclarations: true,
    })
    const semanticStats = await generate({
      ...sharedConfig,
      outdir: 'dist-semantic',
      isolatedDeclarations: false,
    })

    expect(isolatedStats.generationMode).toBe('isolated')
    expect(semanticStats.generationMode).toBe('semantic')
    expect(await readFile(join(cwd, 'dist-isolated', 'index.d.ts'), 'utf8')).toContain('Record<string, string>')
    expect(await readFile(join(cwd, 'dist-semantic', 'index.d.ts'), 'utf8')).toContain('Record<string, string>')
  })

  it('restores declaration maps on clean incremental cache hits', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-cached-maps-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: string = 'test';`)
    const config = {
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: true,
      clean: true,
      incremental: true,
      declarationMap: true,
      isolatedDeclarations: true,
    }

    await generate(config)
    await generate(config)

    const declaration = await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')
    await access(join(cwd, 'dist', 'index.d.ts.map'))
    expect(declaration).toContain('//# sourceMappingURL=index.d.ts.map')
  })
})

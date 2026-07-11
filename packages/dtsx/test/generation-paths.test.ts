import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('treats explicit annotations as authoritative in isolated mode', () => {
    const source = `export const values: Record<string, string> = { answer: 'yes' };`

    const result = processSourceIsolated(source, 'isolated.ts')

    expect(result).toContain('export declare const values: Record<string, string>;')
    expect(result).not.toContain('answer:')
  })

  it('does not retain annotated initializers in isolated mode', () => {
    const source = `
      export const values: Array<string> = createVeryExpensiveValue({
        deeply: { nested: ['implementation', 'details'] },
      });
    `

    const [declaration] = extractDeclarations(source, 'isolated.ts', true, true)

    expect(declaration.typeAnnotation).toBe('Array<string>')
    expect(declaration.value).toBeUndefined()
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
    expect(await readFile(join(cwd, 'dist-semantic', 'index.d.ts'), 'utf8')).toContain("answer: 'yes'")
  })
})

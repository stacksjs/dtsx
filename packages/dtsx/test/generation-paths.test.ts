import { afterEach, describe, expect, it } from 'bun:test'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  it('refuses destructive cleaning when outdir contains the source root', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-clean-boundary-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: string = 'safe';`)
    await writeFile(join(cwd, 'src', 'authored.d.ts'), `export interface Authored { safe: true }`)

    await expect(generate({
      cwd,
      root: 'src',
      outdir: '.',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
    })).rejects.toThrow('contains the source root')

    expect(await readFile(join(cwd, 'src', 'authored.d.ts'), 'utf8')).toContain('Authored')
  })

  it('detects source overlap through an outdir symlink', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-clean-symlink-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: string = 'safe';`)
    await writeFile(join(cwd, 'src', 'authored.d.ts'), `export interface Authored { safe: true }`)
    await symlink(join(cwd, 'src'), join(cwd, 'dist'))

    await expect(generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
    })).rejects.toThrow('contains the source root')

    expect(await readFile(join(cwd, 'src', 'authored.d.ts'), 'utf8')).toContain('Authored')
  })

  it('rejects bundle outputs that escape outdir', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-bundle-boundary-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: string = 'safe';`)

    await expect(generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      bundle: true,
      bundleOutput: '../escaped.d.ts',
      keepComments: false,
      clean: false,
      isolatedDeclarations: true,
    })).rejects.toThrow('stay within outdir')

    await expect(access(join(cwd, 'escaped.d.ts'))).rejects.toThrow()
  })

  it('rejects absolute bundle output paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-absolute-bundle-'))
    tempDirectories.push(cwd)

    await expect(generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: [],
      bundle: true,
      bundleOutput: join(cwd, 'escaped.d.ts'),
      keepComments: false,
      clean: false,
      isolatedDeclarations: true,
    })).rejects.toThrow('relative to outdir')
  })

  it('treats concrete annotations as authoritative in isolated mode', () => {
    const source = `export const value: string = createVeryExpensiveValue({ answer: 'yes' });`

    const result = processSourceIsolated(source, 'isolated.ts')

    expect(result).toContain('export declare const value: string;')
    expect(result).not.toContain('answer:')
  })

  it('preserves an annotated local record referenced by a default export', () => {
    const source = `
      declare const formatRounded: (x: number, p?: number) => string
      const formatTypes: Record<string, (x: number, p?: number) => string> = {
        rounded: formatRounded as (x: number, p?: number) => string,
      }
      export default formatTypes
    `

    const result = processSourceIsolated(source, 'formatTypes.ts', false)

    expect(result).toContain('declare const formatTypes: Record<string, (x: number, p?: number) => string>;')
    expect(result).toContain('export default formatTypes;')
    expect(result).not.toContain('formatRounded as')
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

  it('fast-skips terminated single-line literals without consuming following declarations', () => {
    const source = [
      `export const object: { nested: { value: string }, callback: () => number } = { nested: { value: ';' }, callback: () => 42 };`,
      `export const array: readonly string[] = ['one', ';', 'three'];`,
      `export const quoted: string = 'a value with ; and } delimiters';`,
      'export const template: string = `a template with ; and ] delimiters`;',
      `export const after: number = 42;`,
      `export const sameLineObject: { value: string } = { value: 'one' }; export const sameLineAfter: { value: string } = { value: 'two' };`,
    ].join('\n')

    const isolated = processSourceIsolated(source, 'terminated.ts', false)
    const semantic = processSourceSemantic(source, 'terminated.ts', false)

    expect(isolated).toBe(semantic)
    expect(isolated).toContain('export declare const object: { nested: { value: string }, callback: () => number };')
    expect(isolated).toContain('export declare const array: readonly string[];')
    expect(isolated).toContain('export declare const quoted: string;')
    expect(isolated).toContain('export declare const template: string;')
    expect(isolated).toContain('export declare const after: number;')
    expect(isolated).toContain('export declare const sameLineObject: { value: string };')
    expect(isolated).toContain('export declare const sameLineAfter: { value: string };')
  })

  it('falls back to balanced scanning for multiline and semicolonless initializers', () => {
    const source = [
      'export const multiline: { value: string } = {',
      `  value: 'kept private',`,
      '};',
      `export const semicolonless: readonly number[] = [1, 2, 3]`,
      `export const after: boolean = true`,
    ].join('\n')

    const isolated = processSourceIsolated(source, 'fallback.ts', false)
    const semantic = processSourceSemantic(source, 'fallback.ts', false)

    expect(isolated).toBe(semantic)
    expect(isolated).toContain('export declare const multiline: { value: string };')
    expect(isolated).toContain('export declare const semicolonless: readonly number[];')
    expect(isolated).toContain('export declare const after: boolean;')
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

  it('skips broad initializers when comments are disabled', () => {
    const source = `export const values: Record<string, string> = createExpensiveValues();`

    const [declaration] = extractDeclarations(source, 'isolated.ts', false, true)
    const result = processSourceIsolated(source, 'isolated.ts', false)

    expect(declaration.value).toBeUndefined()
    expect(result).toBe('export declare const values: Record<string, string>;')
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

  it('infers function and method returns only in semantic mode', () => {
    const source = `
      export function createRecord() { return { answer: 42 } }
      export class Factory { createName() { return 'dtsx' } }
    `

    const semantic = processSourceSemantic(source, 'returns.ts')
    const isolated = processSourceIsolated(source, 'returns.ts')

    expect(semantic).toContain('createRecord(): {')
    expect(semantic).toContain('answer: number')
    expect(semantic).toContain('createName(): string;')
    expect(isolated).toContain('createRecord(): void;')
    expect(isolated).toContain('createName(): void;')
  })

  it('ignores returns from nested implementation bodies', () => {
    const source = `
      export function outer() {
        const nested = () => { return 42 }
        function inner() { return true }
        return 'outer'
      }
    `

    const result = processSourceSemantic(source, 'nested-returns.ts')

    expect(result).toContain('outer(): string;')
    expect(result).not.toContain('number | string')
    expect(result).not.toContain('boolean | string')
  })

  it('preserves shorthand binding types in semantic object inference', () => {
    const source = `export const answer = 42; export const result = { answer };`

    const result = processSourceSemantic(source, 'shorthand.ts')

    expect(result).toContain('answer: typeof answer')
  })

  it('moves default-export expressions into typed ambient bindings', () => {
    const source = `export default { answer: 42, labels: ['fast', 'safe'] }`

    const result = processSourceSemantic(source, 'default-expression.ts')

    expect(result).toContain('declare const __dtsx_default_export__: {')
    expect(result).toContain('answer: number')
    expect(result).toContain('labels: string[]')
    expect(result).toContain('export default __dtsx_default_export__;')
    expect(result).not.toContain('export default {')
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

  it('does not alias structurally different import-order cache keys', () => {
    clearResultCache()
    const source = `
      import type { BunType } from 'bun';
      import type { NodeType } from 'node:fs';
      export interface Result { bun: BunType; node: NodeType }
    `

    const unmatched = processSource(source, 'collision.ts', true, ['node:\0bun'])
    const nodeFirst = processSource(source, 'collision.ts', true, ['node:', 'bun'])

    expect(unmatched.indexOf("from 'bun'")).toBeLessThan(unmatched.indexOf("from 'node:fs'"))
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

  it('keeps incremental dry runs free of filesystem mutations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-dry-run-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: string = 'test';`)
    const baseConfig = {
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: false,
      incremental: true,
      isolatedDeclarations: true,
      logLevel: 'silent' as const,
    }

    await generate(baseConfig)
    const manifestPath = join(cwd, '.dtsx-cache', 'manifest.json')
    const gitignorePath = join(cwd, '.gitignore')
    const manifestBefore = await readFile(manifestPath, 'utf8')
    const gitignoreBefore = await readFile(gitignorePath, 'utf8')
    await rm(join(cwd, 'dist'), { recursive: true, force: true })

    await generate({ ...baseConfig, dryRun: true, clearCache: true, declarationMap: true, bundle: true })

    expect(await readFile(manifestPath, 'utf8')).toBe(manifestBefore)
    expect(await readFile(gitignorePath, 'utf8')).toBe(gitignoreBefore)
    await expect(access(join(cwd, 'dist'))).rejects.toThrow()
  })

  it('validates cached declarations instead of trusting them blindly', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-cached-validation-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: string = 'test';`)
    const config = {
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: false,
      incremental: true,
      isolatedDeclarations: true,
      validate: true,
      logLevel: 'silent' as const,
    }

    await generate(config)
    const cached = await generate(config)

    expect(cached.filesGenerated).toBe(0)
    expect(cached.filesValidated).toBe(1)
    expect(cached.validationErrors).toBe(0)
  })

  it('discovers include patterns in addition to entrypoints without duplicates', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-include-patterns-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const index: string = 'index';`)
    await writeFile(join(cwd, 'src', 'extra.tsx'), `export const extra: string = 'extra';`)

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts', '**/*.ts'],
      include: ['**/*.tsx'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
      logLevel: 'silent',
    })

    expect(stats.filesProcessed).toBe(2)
    await access(join(cwd, 'dist', 'index.d.ts'))
    await access(join(cwd, 'dist', 'extra.d.ts'))
  })

  it('uses module-aware default entrypoints', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-default-entrypoints-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await Promise.all([
      writeFile(join(cwd, 'src', 'index.ts'), `export const ts: string = 'ts';`),
      writeFile(join(cwd, 'src', 'view.tsx'), `export const tsx: string = 'tsx';`),
      writeFile(join(cwd, 'src', 'module.mts'), `export const mts: string = 'mts';`),
      writeFile(join(cwd, 'src', 'common.cts'), `export const cts: string = 'cts';`),
    ])

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
      logLevel: 'silent',
    })

    expect(stats.filesProcessed).toBe(4)
    await Promise.all([
      access(join(cwd, 'dist', 'index.d.ts')),
      access(join(cwd, 'dist', 'view.d.ts')),
      access(join(cwd, 'dist', 'module.d.mts')),
      access(join(cwd, 'dist', 'common.d.cts')),
    ])
  })

  it('applies configured type mappings during generation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-type-mapping-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const value: any = loadValue();`)

    await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
      typeMappings: { rules: [], presets: ['strict'], includeDefaults: false },
    })

    expect(await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')).toContain('value: unknown;')
  })

  it('writes configured CRLF line endings', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-crlf-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `export const first: string = 'a';\nexport const second: string = 'b';`)

    await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
      lineEnding: 'crlf',
    })

    const output = await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')
    expect(output).toContain('\r\n')
    expect(output).not.toMatch(/(?<!\r)\n/)
  })

  it('applies configured declaration ordering', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-ordering-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'index.ts'), `
      export function run(): void {}
      export const value: string = 'test';
    `)

    await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['index.ts'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
      declarationOrder: { kinds: ['variable', 'function'], groupExports: false },
    })

    const output = await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')
    expect(output.indexOf('declare const value')).toBeLessThan(output.indexOf('declare function run'))
  })

  it('supports absolute TypeScript and JavaScript module entrypoints', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-module-formats-'))
    tempDirectories.push(cwd)
    const sourceDirectory = join(cwd, 'src')
    await mkdir(sourceDirectory)
    const sources = [
      ['module.mts', `export const esm: string = 'esm';`],
      ['common.cts', `export const common: string = 'common';`],
      ['component.tsx', `export const component: string = 'component';`],
      ['runtime.mjs', `export const runtime = 'runtime';`],
      ['legacy.cjs', `export const legacy = 'legacy';`],
    ] as const
    await Promise.all(sources.map(([name, content]) => writeFile(join(sourceDirectory, name), content)))

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: sources.map(([name]) => join(sourceDirectory, name)),
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
    })

    expect(stats.filesProcessed).toBe(5)
    await Promise.all([
      access(join(cwd, 'dist', 'module.d.mts')),
      access(join(cwd, 'dist', 'common.d.cts')),
      access(join(cwd, 'dist', 'component.d.ts')),
      access(join(cwd, 'dist', 'runtime.d.mts')),
      access(join(cwd, 'dist', 'legacy.d.cts')),
    ])
  })

  it('does not process declaration files matched by broad globs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-ignore-declarations-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'source.mts'), `export const source: string = 'source';`)
    await writeFile(join(cwd, 'src', 'existing.d.mts'), `export declare const existing: string;`)

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['**/*'],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
    })

    expect(stats.filesProcessed).toBe(1)
    await access(join(cwd, 'dist', 'source.d.mts'))
  })

  it('rejects output collisions instead of overwriting declarations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-output-collision-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src', 'first'), { recursive: true })
    await mkdir(join(cwd, 'src', 'second'), { recursive: true })
    await writeFile(join(cwd, 'src', 'first', 'index.ts'), `export const first: string = 'first';`)
    await writeFile(join(cwd, 'src', 'second', 'index.ts'), `export const second: string = 'second';`)

    const generation = generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['**/*.ts'],
      outputStructure: 'flat',
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
    })

    await expect(generation).rejects.toThrow('Output path collision')
  })

  it('skips absolute entrypoints outside the configured root', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-root-boundary-'))
    tempDirectories.push(cwd)
    await mkdir(join(cwd, 'src'))
    const outsideFile = join(cwd, 'outside.ts')
    await writeFile(outsideFile, `export const outside: string = 'outside';`)

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: [outsideFile],
      keepComments: false,
      clean: true,
      isolatedDeclarations: true,
    })

    expect(stats.filesProcessed).toBe(0)
  })
})

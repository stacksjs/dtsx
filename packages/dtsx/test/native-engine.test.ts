import type { DtsGenerationOption } from '../src/types'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { emitWithNativeEngine, nativeEngineAvailable } from '../src/native-engine'
import { processSource, processSourceDirect, processSourceWithTypeScriptEngine } from '../src/process-source'

// Native unwraps awaited promises; the TypeScript engine does not. The
// difference shows which engine produced a declaration.
const awaited = 'export const value = await Promise.resolve(1)'
const nativeOutput = 'export declare const value: number;'
const typescriptOutput = 'export declare const value: unknown;'

describe.skipIf(!nativeEngineAvailable())('SDK native engine', () => {
  test('emits in-process through the native library', () => {
    expect(emitWithNativeEngine(awaited, { keepComments: true, isolatedDeclarations: false })).toBe(nativeOutput)
    expect(processSourceWithTypeScriptEngine(awaited)).toBe(typescriptOutput)
  })

  test('processSource and processSourceDirect use the native engine', () => {
    expect(processSource(awaited, 'native-routing.ts')).toBe(nativeOutput)
    expect(processSourceDirect(awaited, 'native-direct.ts')).toBe(nativeOutput)
  })

  test('an import order the native engine does not implement uses the TypeScript engine', () => {
    expect(processSource(awaited, 'import-order.ts', true, ['node:', 'bun'])).toBe(typescriptOutput)
  })

  test('input the native engine rejects falls back to the TypeScript engine', () => {
    const unterminated = 'export const a = `unterminated'
    expect(emitWithNativeEngine(unterminated, { keepComments: true, isolatedDeclarations: false })).toBeNull()
    expect(processSource(unterminated, 'rejected.ts')).toBe(processSourceWithTypeScriptEngine(unterminated, 'rejected.ts'))
  })

  test('passes inference sources through the context ABI', () => {
    const source = `import { make } from './make'\nexport const made = make(1)`
    const output = emitWithNativeEngine(source, {
      keepComments: true,
      isolatedDeclarations: false,
      sourceFile: 'consumer.ts',
      inferenceSources: new Map([['./make', 'export function make(value: number) { return { value } }']]),
    })
    expect(output).not.toBeNull()
    expect(output).toContain('made')
  })

  test('DTSX_ENGINE=typescript disables the native engine', () => {
    const script = `import { nativeEngineAvailable } from ${JSON.stringify(join(import.meta.dir, '../src/native-engine'))}\nconsole.log(nativeEngineAvailable())`
    const run = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, DTSX_ENGINE: 'typescript' } })
    expect(run.stdout.toString().trim()).toBe('false')
  })

  test('generate uses native unless a plugin needs declaration objects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dtsx-native-engine-'))
    try {
      const entry = join(dir, 'awaited.ts')
      await writeFile(entry, `${awaited}\n`)
      const base: DtsGenerationOption = { entrypoints: [entry], outdir: join(dir, 'out'), clean: false, outputStructure: 'flat', logLevel: 'silent' }

      // onAfterFile works on emitted text, so native still applies.
      let afterFileRan = false
      await generate({ ...base, plugins: [{ name: 'after', onAfterFile: (ctx) => { afterFileRan = true; return ctx.content } }] })
      expect(afterFileRan).toBe(true)
      expect(await readFile(join(dir, 'out', 'awaited.d.ts'), 'utf8')).toContain(nativeOutput)

      // onDeclarations needs extracted declaration objects: TypeScript engine.
      let declarationsSeen = 0
      await generate({ ...base, plugins: [{ name: 'declarations', onDeclarations: (ctx) => { declarationsSeen = ctx.declarations.length } }] })
      expect(declarationsSeen).toBeGreaterThan(0)
      expect(await readFile(join(dir, 'out', 'awaited.d.ts'), 'utf8')).toContain(typescriptOutput)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

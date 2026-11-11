import type { DtsGenerationOption } from '../src/types'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { emitWithNativeEngine, nativeEngineAvailable, parseDeclarationEngine, resolveDeclarationEngine, setDeclarationEngine } from '../src/native-engine'
import { clearResultCache, processSource, processSourceDirect } from '../src/process-source'

// Native unwraps awaited promises; the TypeScript engine does not. The
// difference shows which engine produced a declaration.
const awaited = 'export const value = await Promise.resolve(1)'
const nativeOutput = 'export declare const value: number;'
const typescriptOutput = 'export declare const value: unknown;'
const cli = join(import.meta.dir, '../bin/cli.ts')
const nativeModule = JSON.stringify(join(import.meta.dir, '../src/native-engine'))

function environment(engine?: string): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  delete env.DTSX_ENGINE
  if (engine !== undefined) env.DTSX_ENGINE = engine
  return env
}

function run(args: string[], options: { cwd?: string, stdin?: string, engine?: string } = {}) {
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    cwd: options.cwd,
    env: environment(options.engine),
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

async function directory(check: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dtsx-engine-option-'))
  try { await check(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

afterEach(() => {
  setDeclarationEngine(undefined)
  clearResultCache()
})

describe('engine names', () => {
  test('native and typescript are the only engines', () => {
    expect(parseDeclarationEngine('native')).toBe('native')
    expect(parseDeclarationEngine('typescript')).toBe('typescript')
    expect(parseDeclarationEngine(undefined)).toBeUndefined()
    expect(parseDeclarationEngine('')).toBeUndefined()
    for (const invalid of ['ts', 'zig', 'Native', 1, true, {}])
      expect(() => parseDeclarationEngine(invalid, 'engine')).toThrow('expected "native" or "typescript"')
  })

  test('a call\'s engine wins over the process engine, which wins over the default', () => {
    expect(resolveDeclarationEngine()).toBe(process.env.DTSX_ENGINE === 'typescript' ? 'typescript' : 'native')
    setDeclarationEngine('typescript')
    expect(resolveDeclarationEngine()).toBe('typescript')
    expect(resolveDeclarationEngine('native')).toBe('native')
    setDeclarationEngine(undefined)
    expect(resolveDeclarationEngine('typescript')).toBe('typescript')
  })

  test('DTSX_ENGINE sets the default and an explicit engine overrides it', () => {
    const script = `import { nativeEngineAvailable, resolveDeclarationEngine, setDeclarationEngine } from ${nativeModule}
const fromEnvironment = [resolveDeclarationEngine(), nativeEngineAvailable(), resolveDeclarationEngine('native')]
setDeclarationEngine('native')
console.log(JSON.stringify([...fromEnvironment, resolveDeclarationEngine()]))`
    const typescript = Bun.spawnSync([process.execPath, '-e', script], { env: environment('typescript') })
    expect(JSON.parse(typescript.stdout.toString())).toEqual(['typescript', false, 'native', 'native'])
    const unset = Bun.spawnSync([process.execPath, '-e', script], { env: environment() })
    expect(JSON.parse(unset.stdout.toString()).slice(0, 1)).toEqual(['native'])
  })

  test('an unknown DTSX_ENGINE is an error, not a silent default', () => {
    const script = `import { resolveDeclarationEngine } from ${nativeModule}\nresolveDeclarationEngine()`
    const result = Bun.spawnSync([process.execPath, '-e', script], { env: environment('bogus'), stderr: 'pipe' })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('Invalid DTSX_ENGINE "bogus"')
  })
})

describe('the typescript engine is always selectable', () => {
  test('processSource and processSourceDirect take an engine', () => {
    expect(processSource(awaited, 'option.ts', true, ['bun'], false, 'typescript')).toBe(typescriptOutput)
    expect(processSourceDirect(awaited, 'option.ts', true, ['bun'], false, 'typescript')).toBe(typescriptOutput)
  })

  test('the native emitter declines an emission that asks for typescript', () => {
    expect(emitWithNativeEngine(awaited, { keepComments: true, isolatedDeclarations: false, engine: 'typescript' })).toBeNull()
    expect(nativeEngineAvailable('typescript')).toBe(false)
  })

  test('the process engine applies to calls that name none', () => {
    setDeclarationEngine('typescript')
    expect(processSource(awaited, 'process-default.ts')).toBe(typescriptOutput)
    expect(nativeEngineAvailable()).toBe(false)
  })

  test('generate honours the engine option and rejects an unknown one', () => directory(async (root) => {
    const entry = join(root, 'awaited.ts')
    await writeFile(entry, `${awaited}\n`)
    const base: DtsGenerationOption = { entrypoints: [entry], outdir: join(root, 'out'), clean: false, outputStructure: 'flat', logLevel: 'silent' }
    await generate({ ...base, engine: 'typescript' })
    expect(await readFile(join(root, 'out', 'awaited.d.ts'), 'utf8')).toContain(typescriptOutput)
    await expect(generate({ ...base, engine: 'zig' as any })).rejects.toThrow('Invalid engine "zig"')
  }))
})

describe.skipIf(!nativeEngineAvailable('native'))('native is the default and stays selectable', () => {
  test('each engine keeps its own cached result for one file', () => {
    expect(processSource(awaited, 'shared.ts')).toBe(nativeOutput)
    expect(processSource(awaited, 'shared.ts', true, ['bun'], false, 'typescript')).toBe(typescriptOutput)
    expect(processSource(awaited, 'shared.ts', true, ['bun'], false, 'native')).toBe(nativeOutput)
    setDeclarationEngine('typescript')
    expect(processSource(awaited, 'shared.ts')).toBe(typescriptOutput)
    expect(processSource(awaited, 'shared.ts', true, ['bun'], false, 'native')).toBe(nativeOutput)
  })

  test('generate defaults to native and accepts it by name', () => directory(async (root) => {
    const entry = join(root, 'awaited.ts')
    await writeFile(entry, `${awaited}\n`)
    const base: DtsGenerationOption = { entrypoints: [entry], outdir: join(root, 'out'), clean: false, outputStructure: 'flat', logLevel: 'silent' }
    for (const engine of [undefined, 'native'] as const) {
      await generate({ ...base, engine })
      expect(await readFile(join(root, 'out', 'awaited.d.ts'), 'utf8')).toContain(nativeOutput)
    }
  }))

  test('the CLI --engine flag works on every command, in either position and form', () => directory(async (root) => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/awaited.ts'), `${awaited}\n`)
    expect(run(['emit', 'src/awaited.ts'], { cwd: root }).stdout).toContain(nativeOutput)
    expect(run(['emit', 'src/awaited.ts', '--engine', 'native'], { cwd: root, engine: 'typescript' }).stdout).toContain(nativeOutput)
    expect(run(['emit', 'src/awaited.ts', '--engine', 'typescript'], { cwd: root }).stdout).toContain(typescriptOutput)
    expect(run(['--engine=typescript', 'emit', 'src/awaited.ts'], { cwd: root }).stdout).toContain(typescriptOutput)
    expect(run(['emit', 'src/awaited.ts'], { cwd: root, engine: 'typescript' }).stdout).toContain(typescriptOutput)
    expect(run(['stdin', '--engine', 'typescript'], { stdin: awaited }).stdout).toContain(typescriptOutput)
    expect(run(['stdin'], { stdin: awaited }).stdout).toContain(nativeOutput)

    expect(run(['--project', 'src', '--outdir', 'project-ts', '--engine', 'typescript'], { cwd: root }).exitCode).toBe(0)
    expect(await readFile(join(root, 'project-ts/awaited.d.ts'), 'utf8')).toContain(typescriptOutput)
    expect(run(['--project', 'src', '--outdir', 'project-native'], { cwd: root }).exitCode).toBe(0)
    expect(await readFile(join(root, 'project-native/awaited.d.ts'), 'utf8')).toContain(nativeOutput)

    const generated = run(['generate', '--root', 'src', '--outdir', 'generated-ts', '--engine', 'typescript', '--log-level', 'silent'], { cwd: root })
    expect(generated.exitCode, generated.stderr).toBe(0)
    expect(await readFile(join(root, 'generated-ts/awaited.d.ts'), 'utf8')).toContain(typescriptOutput)
  }), 60_000)

  test('a config file selects the engine and the flag overrides it', () => directory(async (root) => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/awaited.ts'), `${awaited}\n`)
    await writeFile(join(root, 'dtsx.config.ts'), `export default { engine: 'typescript' }\n`)
    const fromConfig = run(['generate', '--root', 'src', '--outdir', 'from-config', '--log-level', 'silent'], { cwd: root })
    expect(fromConfig.exitCode, fromConfig.stderr).toBe(0)
    expect(await readFile(join(root, 'from-config/awaited.d.ts'), 'utf8')).toContain(typescriptOutput)
    const overridden = run(['generate', '--root', 'src', '--outdir', 'overridden', '--engine', 'native', '--log-level', 'silent'], { cwd: root })
    expect(overridden.exitCode, overridden.stderr).toBe(0)
    expect(await readFile(join(root, 'overridden/awaited.d.ts'), 'utf8')).toContain(nativeOutput)
  }), 60_000)
})

describe('the CLI rejects a bad --engine', () => {
  test.each([
    [['emit', 'x.ts', '--engine', 'zig'], 'Invalid --engine "zig"'],
    [['emit', 'x.ts', '--engine'], '--engine needs a value'],
    [['--engine=', 'emit', 'x.ts'], '--engine needs a value'],
  ])('%j', (args, message) => {
    const result = run(args)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(message)
  })
})

import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from '../../bun-plugin/src'
import * as native from '../../zig-dtsx/src'
import { generate } from '../src/generator'
import { processSource } from '../src/process-source'
import { isAvailable, runTsc } from './helpers/tsc'

// Structured writes are currently an explicit unsupported inference boundary.
// Valid authored input must produce a diagnostic, never a success-shaped empty
// result or a fabricated public alias type.
const unsupported = 'let privateValue: number | undefined = 7;\nif (Math.random() > 0.5) { privateValue = undefined; }\nexport const value = privateValue;\n'
const unused = 'let privateValue: number | undefined = 7;\nif (Math.random() > 0.5) { privateValue = undefined; }\nconst unusedAlias = privateValue;\nexport const healthy: number = 1;\n'
const annotated = 'let privateValue: number | undefined = 7;\nif (Math.random() > 0.5) { privateValue = undefined; }\nexport const value: number | undefined = privateValue;\n'

const invalidationCases = [
  { name: 'an evaluated static field property continuation named static', source: 'let privateValue: number | undefined = 7; const object = { static(input: unknown) { return input; } }; const box = class { static field = object.\nstatic(privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'a modified static member after a generic instance field', source: 'let privateValue: number | undefined = 7; const identity = <T>(input: T) => input; const box = class { field = identity<number>\n public static effect = (privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'a static write after a semicolon-free generic field', source: 'let privateValue: number | undefined = 7; const identity = <T>(input: T) => input; const box = class { field = identity<number>\n static effect = (privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'an outer write in a shadowing static member initializer', source: 'let privateValue: number | undefined = 7; const box = class { static privateValue = (privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'a static write after a semicolon-free deferred instance field', source: 'let privateValue: number | undefined = 7; const box = class { field = (privateValue = undefined)\n static effect = (privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'an evaluated static field named static', source: 'let privateValue: number | undefined = 7; const box = class { static static = (privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'evaluated class heritage', source: 'let privateValue: number | undefined = 7; const box = class extends (privateValue = undefined, Object) {}; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'an evaluated class computed method name', source: 'let privateValue: number | undefined = 7; const box = class { [String(privateValue = undefined)]() {} }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'an evaluated class static field', source: 'let privateValue: number | undefined = 7; const box = class { static field = (privateValue = undefined); }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'an evaluated class static block', source: 'let privateValue: number | undefined = 7; const box = class { static { privateValue = undefined; } }; export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
  { name: 'an inactive initializer assignment', source: 'let privateValue: number | undefined = 7; const implementationOnly = (privateValue = undefined); export const value = privateValue;', positive: 'undefined', negative: 'number' },
  { name: 'a nested logical-or assignment', source: "let privateValue: number | string = 0; if (Math.random() > 0.5) { privateValue ||= 'changed'; }\nexport const value = privateValue;", positive: 'number | string', negative: 'number' },
  { name: 'a same-line export after a conditional block', source: "let privateValue: number | string = 0; if (Math.random() > 0.5) { privateValue ||= 'changed'; } export const value = privateValue;", positive: 'number | string', negative: 'number' },
  { name: 'a nested logical-and assignment', source: "let privateValue: number | string = 1; if (Math.random() > 0.5) { privateValue &&= 'changed'; } export const value = privateValue;", positive: 'number | string', negative: 'number' },
  { name: 'a nested nullish assignment', source: 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { privateValue ??= 9; } export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a nested postfix update', source: 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { privateValue++; } export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a nested prefix update', source: 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { --privateValue; } export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a chained write with two inferred aliases', source: 'let privateValue: number | undefined = 7; let other: number | undefined = 0; other = privateValue = undefined; export const value = privateValue; export const otherValue = other;', positive: 'undefined', negative: 'number' },
  { name: 'a real compact postfix update before addition', source: 'let privateValue: number | undefined = 7; let other = 1; const ignored = privateValue+++other; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an immediately invoked function initializer write', source: 'let privateValue: number | undefined = 7; const ignored = (() => { privateValue = undefined; })(); export const value = privateValue;', positive: 'number | undefined', negative: 'null' },
] as const

const preservedFlowCases = [
  { name: 'a readonly value name followed by another export', source: 'const readonly = 7; export const value: number = readonly\nexport const other = 3;', positive: 'number', negative: 'undefined' },
  { name: 'an unused function expression with a keyof object return operand', source: 'let privateValue: number | undefined = 7; const deferred = function (): keyof /* result */ { value: number } { privateValue = undefined; return "value"; }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused function expression with a readonly object-array return operand', source: 'let privateValue: number | undefined = 7; const deferred = function (): readonly // result\n { value: number }[]\n { privateValue = undefined; return []; }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused function expression with conditional object return operands', source: 'let privateValue: number | undefined = 7; const deferred = function <T>(): T extends string ? /* result */ { value: T } : { other: T } { privateValue = undefined; throw new Error(); }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an uncalled function with a keyof object return operand', source: 'let privateValue: number | undefined = 7; function deferred(): keyof /* result */ { value: number } { privateValue = undefined; return "value"; } export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an uncalled function with a readonly object-array return operand', source: 'let privateValue: number | undefined = 7; function deferred(): readonly // result\n { value: number }[] { privateValue = undefined; return []; } export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an uncalled function with conditional object return operands', source: 'let privateValue: number | undefined = 7; function deferred<T>(): T extends string ? /* result */ { value: T } : { other: T } { privateValue = undefined; throw new Error(); } export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a deferred instance field property continuation named static', source: 'let privateValue: number | undefined = 7; const object = { static(input: unknown) { return input; } }; const box = class { field = object.\nstatic(privateValue = undefined); }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused instance field initializer', source: 'let privateValue: number | undefined = 7; const box = class { field = (privateValue = undefined); }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a static field name that shadows an outer binding', source: 'let privateValue: number | undefined = 7; const box = class { static privateValue = 0; }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a deferred instance field with a shadowing member name', source: 'let privateValue: number | undefined = 7; const box = class { privateValue = (privateValue = undefined); }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a deferred private instance field', source: 'let privateValue: number | undefined = 7; const box = class { #privateValue = (privateValue = undefined); }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a private static property update rather than an outer write', source: 'let privateValue: number | undefined = 7; const box = class { static #privateValue = 0; static { this.#privateValue++; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'adjacent semicolon-free instance fields', source: 'let privateValue: number | undefined = 7; const box = class { field = (privateValue = undefined)\n other = 0\n static stable = 1; }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a deferred instance field named static', source: 'let privateValue: number | undefined = 7; const box = class { static = (privateValue = undefined); }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a deferred computed instance field initializer', source: "let privateValue: number | undefined = 7; const key = 'field'; const box = class { [key] = (privateValue = undefined); }; export const value = privateValue;", positive: 'number', negative: 'undefined' },
  { name: 'a static field type query rather than an outer write', source: 'let privateValue: number | undefined = 7; const box = class { static field: typeof privateValue = 0; }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused class expression method body', source: 'let privateValue: number | undefined = 7; const box = class { mutate() { privateValue = undefined; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an uncalled class constructor and its default parameter', source: 'let privateValue: number | undefined = 7; const box = class { constructor(parameter = (privateValue = undefined)) { privateValue = undefined; void parameter; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused static class method', source: 'let privateValue: number | undefined = 7; const box = class { static mutate() { privateValue = undefined; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused private generic class method', source: 'let privateValue: number | undefined = 7; const box = class { private mutate<T>(parameter: T): T { privateValue = undefined; return parameter; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused class private-identifier method', source: 'let privateValue: number | undefined = 7; const box = class { #mutate() { privateValue = undefined; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a class method after a semicolon-free field', source: 'let privateValue: number | undefined = 7; const box = class { field = String(1)\n mutate() { privateValue = undefined; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused getter after another class method', source: 'let privateValue: number | undefined = 7; const box = class { constructor() {} get mutate() { privateValue = undefined; return 0; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused object method body', source: 'let privateValue: number | undefined = 7; const box = { mutate() { privateValue = undefined; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused object method parameter default', source: 'let privateValue: number | undefined = 7; const box = { mutate(value = (privateValue = undefined)) { return value; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused generic object method body', source: 'let privateValue: number | undefined = 7; const box = { mutate<T>(value: T): T { privateValue = undefined; return value; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused getter body', source: 'let privateValue: number | undefined = 7; const box = { get mutate() { privateValue = undefined; return 0; } }; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'an unused computed object method body', source: "let privateValue: number | undefined = 7; const key = 'mutate'; const box = { [key]() { privateValue = undefined; } }; export const value = privateValue;", positive: 'number', negative: 'undefined' },
  { name: 'a compact inactive postfix operator before addition', source: 'let privateValue: number | undefined = 7; let other = 1; const ignored = other+++privateValue; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a spaced inactive postfix operator before addition', source: 'let privateValue: number | undefined = 7; let other = 1; const ignored = other++ + privateValue; export const value = privateValue;', positive: 'number', negative: 'undefined' },
  { name: 'a compact inactive postfix operator before subtraction', source: 'let privateValue: number | undefined = 7; let other = 1; const ignored = other---privateValue; export const value = privateValue;', positive: 'number', negative: 'undefined' },
] as const

for (const fixture of [...invalidationCases, ...preservedFlowCases]) {
  test(`${fixture.name} has valid authored typing and an effective negative control`, async () => {
    expect(isAvailable).toBe(true)
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-flow-invalidation-source-'))
    try {
      await writeFile(join(directory, 'index.ts'), fixture.source)
      await writeFile(join(directory, 'consumer.ts'), `import { value } from './index.js'\nconst check: ${fixture.positive} = value\nvoid check\n`)
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
      const authored = runTsc(directory, ['--project', 'tsconfig.json'])
      expect(authored.ok, authored.output).toBe(true)
      await writeFile(join(directory, 'consumer.ts'), `import { value } from './index.js'\nconst invalid: ${fixture.negative} = value\nvoid invalid\n`)
      const negative = runTsc(directory, ['--project', 'tsconfig.json'])
      expect(negative.ok, negative.output).toBe(false)
      expect(negative.output.match(/error TS\d+/g), negative.output).toEqual(['error TS2322'])
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
}

function failure(operation: () => unknown): unknown {
  try { operation() }
  catch (error) { return error }
  return undefined
}

test('unsupported flow input is a valid authored strict TypeScript contract', async () => {
  expect(isAvailable).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-flow-source-'))
  try {
    await writeFile(join(directory, 'index.ts'), unsupported)
    await writeFile(join(directory, 'consumer.ts'), "import { value } from './index.js'\nconst maybe: number | undefined = value\nvoid maybe\n")
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
    const authored = runTsc(directory, ['--project', 'tsconfig.json'])
    expect(authored.ok, authored.output).toBe(true)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

for (const producer of [
  { name: 'core', emit: (source: string) => processSource(source, 'index.ts') },
  { name: 'native', emit: (source: string) => native.processSource(source) },
]) {
  for (const fixture of preservedFlowCases) {
    test(`${producer.name} preserves ${fixture.name} without a fictitious flow error`, () => {
      if (producer.name === 'native') expect(native.ZIG_CHECKED_AVAILABLE).toBe(true)
      const output = producer.emit(fixture.source)
      expect(output).toContain('value: number;')
      expect(output).not.toContain('value: unknown;')
    })
  }

  for (const fixture of invalidationCases) {
    test(`${producer.name} diagnoses ${fixture.name} instead of fabricating alias typing`, () => {
      if (producer.name === 'native') expect(native.ZIG_CHECKED_AVAILABLE).toBe(true)
      const error = failure(() => producer.emit(fixture.source))
      expect(error).toBeInstanceOf(Error)
      expect(error).toHaveProperty('code', 'DTSX_UNSUPPORTED_VALUE_FLOW')
    })
  }

  test(`${producer.name} excludes properties and deferred function bodies from local writes`, () => {
    const prefix = 'let privateValue: number | undefined = 7; '
    for (const statement of [
      'const implementationOnly = (privateValue: number) => { privateValue++; }; ',
      'const implementationOnly = function (privateValue: number) { privateValue++; }; ',
      'const implementationOnly = (parameter = (privateValue = undefined)) => parameter; ',
      'const implementationOnly = (parameter = (privateValue = undefined)): undefined => parameter; ',
      'const implementationOnly = privateValue + +1; ',
      'const box = { privateValue: 0 }; if (Math.random() > 0.5) { box.privateValue++; } ',
    ]) {
      const output = producer.emit(`${prefix}${statement}export const value = privateValue;`)
      expect(output).toContain('value: number;')
      expect(output).not.toContain('value: unknown;')
    }
  })

  test(`${producer.name} preserves a same-line export after a nonmutating block`, () => {
    expect(producer.emit('if (Math.random() > 0.5) { void 0; } export const healthy: number = 1;')).toContain('healthy: number;')
  })

  test(`${producer.name} reports unsupported emitted flow and preserves valid empty output`, () => {
    if (producer.name === 'native') expect(native.ZIG_CHECKED_AVAILABLE).toBe(true)
    const error = failure(() => producer.emit(unsupported))
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty('code', 'DTSX_UNSUPPORTED_VALUE_FLOW')
    expect(producer.emit('')).toBe('')
    expect(producer.emit(unused)).toContain('healthy: number')
    expect(producer.emit(unused)).not.toContain('unusedAlias')
    expect(producer.emit(annotated)).toContain('value: number | undefined')
  })
}

test('checked native batch and contextual emission propagate flow errors without sticky failures', () => {
  expect(native.ZIG_CHECKED_AVAILABLE).toBe(true)
  expect(native.ZIG_CHECKED_BATCH_AVAILABLE).toBe(true)
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const batchError = failure(() => native.processBatch(['export const healthy: number = 1', unsupported, ''], true, 2))
  expect(batchError).toHaveProperty('code', 'DTSX_UNSUPPORTED_VALUE_FLOW')
  expect(native.processBatch(['', 'export const healthy: number = 1'], true, 2)).toEqual(['', 'export declare const healthy: number;'])
  const contextError = failure(() => native.processSourceWithContext(unsupported, {
    version: 1, moduleSpecifierMode: 'preserve', sourceFile: '/source/index.ts', outputFile: '/output/index.d.ts',
    sourceHash: new Bun.CryptoHasher('sha256').update(unsupported).digest('hex'), rewrites: [],
  }))
  expect(contextError).toHaveProperty('code', 'DTSX_UNSUPPORTED_VALUE_FLOW')
  expect(native.processSource('export const healthy: number = 1')).toContain('healthy: number')
})

for (const producer of ['core', 'bun-plugin'] as const) {
  test(`${producer} rejects unsupported flow before replacing prior declaration output`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-flow-publication-'))
    try {
      await mkdir(join(directory, 'src'))
      await mkdir(join(directory, 'dist'))
      const previous = 'export interface Previous { scale: number }\n'
      const runtime = 'export const runtime = 1\n'
      await writeFile(join(directory, 'src/index.ts'), unsupported)
      await writeFile(join(directory, 'dist/index.d.ts'), previous)
      await writeFile(join(directory, 'dist/keep.js'), runtime)
      const options = { cwd: directory, root: './src', entrypoints: ['index.ts'], outdir: './dist', clean: true, isolatedDeclarations: false }
      if (producer === 'core') await expect(generate(options)).rejects.toThrow('unsupported source value flow')
      else {
        let success: boolean | undefined
        let diagnostics = ''
        let error: unknown
        try {
          const result = await Bun.build({ entrypoints: [join(directory, 'src/index.ts')], outdir: join(directory, 'dist'), target: 'bun', plugins: [dts(options)], throw: false })
          success = result.success
          diagnostics = result.logs.map(log => log.message).join('\n')
        }
        catch (caught) { error = caught }
        if (error !== undefined) {
          expect(error).toBeInstanceOf(Error)
          expect(error).toHaveProperty('message', expect.stringContaining('unsupported source value flow'))
        }
        else {
          expect(success).toBe(false)
          expect(diagnostics).toContain('unsupported source value flow')
        }
      }
      expect(await readFile(join(directory, 'dist/index.d.ts'), 'utf8')).toBe(previous)
      expect(await readFile(join(directory, 'dist/keep.js'), 'utf8')).toBe(runtime)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
}

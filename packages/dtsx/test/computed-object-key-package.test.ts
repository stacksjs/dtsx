import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DeclarationPackageCase } from './helpers/declaration-package'
import { checkDeclarationPackage } from './helpers/declaration-package'
import { BuildCache } from '../src/cache'
import { defaultConfig } from '../src/config'
import { planDeclarationProject } from '../src/declaration-project'
import { generate } from '../src/generator'
import { isAvailable, runTsc } from './helpers/tsc'

const cases: Record<string, DeclarationPackageCase> = {
  'private string bindings in template-computed keys': {
    source: "const COMPUTED_KEY = 'dynamicProperty'\nexport const computedObject = { [COMPUTED_KEY]: 'value', [`prefix_${COMPUTED_KEY}`]: 'prefixed' }\n",
    positive: "const value: string = api.computedObject.dynamicProperty\nconst prefixed: string = api.computedObject.prefix_dynamicProperty\nconst key: keyof typeof api.computedObject = 'prefix_dynamicProperty'\nvoid [value, prefixed, key]",
    negatives: [
      { code: 2322, content: 'const invalid: number = api.computedObject.prefix_dynamicProperty\nvoid invalid' },
      { code: 2322, content: "const invalid: keyof typeof api.computedObject = 'missing'\nvoid invalid" },
      { code: 2339, content: 'void api.COMPUTED_KEY' },
    ],
  },
  'direct literals, identifier keys and private unique symbols': {
    source: "const STRING_KEY = 'constant'\nconst SYMBOL_KEY: unique symbol = Symbol('key')\nexport const exposedSymbol: typeof SYMBOL_KEY = SYMBOL_KEY\nexport const computedObject = { ['literal']: 7, [STRING_KEY]: 'text', [SYMBOL_KEY]: true, [3]: 'three' }\n",
    positive: "const literal: number = api.computedObject.literal\nconst named: string = api.computedObject.constant\nconst symbol: boolean = api.computedObject[api.exposedSymbol]\nconst numeric: string = api.computedObject[3]\nconst key: keyof typeof api.computedObject = 3\nvoid [literal, named, symbol, numeric, key]",
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject[api.exposedSymbol]\nvoid invalid' },
      { code: 2322, content: "const invalid: keyof typeof api.computedObject = '3'\nvoid invalid" },
      { code: 2339, content: 'void api.SYMBOL_KEY' },
    ],
  },
  'cooked escapes in constant template keys': {
    source: "export const computedObject = { [`plain`]: 'value', [`escaped\\n\\u0061`]: 7 }\n",
    positive: "const plain: string = api.computedObject.plain\nconst escaped: number = api.computedObject['escaped\\na']\nvoid [plain, escaped]",
    negatives: [
      { code: 2322, content: "const invalid: string = api.computedObject['escaped\\na']\nvoid invalid" },
      { code: 2820, content: "const invalid: keyof typeof api.computedObject = 'escapedna'\nvoid invalid" },
    ],
  },
  'multiple constant substitutions and transitive aliases': {
    source: "const ROOT = 'root'\nconst ALIAS = ROOT\nconst ORDINAL = 7\nexport const computedObject = { [`${ALIAS}_${ORDINAL}`]: 'value' }\n",
    positive: 'const value: string = api.computedObject.root_7\nvoid value',
    negatives: [
      { code: 2322, content: 'const invalid: number = api.computedObject.root_7\nvoid invalid' },
      { code: 2322, content: "const invalid: keyof typeof api.computedObject = 'root_8'\nvoid invalid" },
    ],
  },
  'nested object and array element computed keys': {
    source: "const KEY = 'field'\nexport const computedObject = { nested: { [`prefix_${KEY}`]: true }, list: [{ [`prefix_${KEY}`]: 3 }] }\n",
    positive: 'const nested: boolean = api.computedObject.nested.prefix_field\nconst item: number = api.computedObject.list[0].prefix_field\nvoid [nested, item]',
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject.nested.prefix_field\nvoid invalid' },
      { code: 2322, content: 'const invalid: string = api.computedObject.list[0].prefix_field\nvoid invalid' },
    ],
  },
  'readonly constant template properties': {
    source: "const KEY = 'key'\nexport const computedObject = { [`prefix_${KEY}`]: 7 } as const\n",
    positive: 'const exact: 7 = api.computedObject.prefix_key\nvoid exact',
    negatives: [
      { code: 2322, content: 'const invalid: 8 = api.computedObject.prefix_key\nvoid invalid' },
      { code: 2540, content: 'api.computedObject.prefix_key = 7' },
    ],
  },
  'string index semantics for a widened template substitution': {
    source: "const WIDE: string = 'key'\nexport const computedObject = { stable: true, [`prefix_${WIDE}`]: 7 }\n",
    positive: "const stable: boolean = api.computedObject.stable\nconst indexed: number | boolean = api.computedObject.anything\nconst numericKey: keyof typeof api.computedObject = 7\nvoid [stable, indexed, numericKey]",
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject.anything\nvoid invalid' },
      { code: 2322, content: 'const invalid: number = api.computedObject.stable\nvoid invalid' },
    ],
  },
  'accessor value types in computed string indices': {
    source: "const WIDE: string = 'key'\nconst SYMBOL_KEY: unique symbol = Symbol('key')\nexport const exposedSymbol: typeof SYMBOL_KEY = SYMBOL_KEY\nexport const computedObject = { get stable(): number { return 7 }, set flag(value: boolean) { void value }, get writable(): number { return 9 }, set writable(value: RegExp) { void value }, get [SYMBOL_KEY](): Date { return new Date() }, [`prefix_${WIDE}`]: 'value' }\n",
    positive: 'const stable: number = api.computedObject.stable\nconst flag: boolean = api.computedObject.flag\nconst symbol: Date = api.computedObject[api.exposedSymbol]\nconst indexed: string | number | boolean = api.computedObject.anything\napi.computedObject.writable = /value/\nvoid [stable, flag, symbol, indexed]',
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject.stable\nvoid invalid' },
      { code: 2322, content: 'const invalid: Date = api.computedObject.anything\nvoid invalid' },
    ],
  },
  'arithmetic, nested templates and comments in constant keys': {
    source: "const KEY = 'root'\nconst ORDINAL = 1 + 2\nexport const computedObject = { [`pre_${`nested_${/* key */ KEY}`}_${(1 + 2) * 4}`]: 7, [`num_${ORDINAL}`]: false }\n",
    positive: 'const nested: number = api.computedObject.pre_nested_root_12\nconst ordinal: boolean = api.computedObject.num_3\nvoid [nested, ordinal]',
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject.pre_nested_root_12\nvoid invalid' },
      { code: 2322, content: "const invalid: keyof typeof api.computedObject = 'absent'\nvoid invalid" },
    ],
  },
  'index semantics for annotated, asserted, boolean and mutable substitutions': {
    source: "const ANNOTATED: 'a' = 'a'\nconst ASSERTED = 'b' as const\nconst FLAG = true\nlet mutable = 'c'\nexport const computedObject = { annotated: { [`prefix_${ANNOTATED}`]: 7 }, asserted: { [`prefix_${ASSERTED}`]: 7 }, boolean: { [`prefix_${FLAG}`]: 7 }, mutable: { [`prefix_${mutable}`]: 7 } }\n",
    positive: 'const values: number[] = [api.computedObject.annotated.anything, api.computedObject.asserted.anything, api.computedObject.boolean.anything, api.computedObject.mutable.anything]\nvoid values',
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject.annotated.anything\nvoid invalid' },
      { code: 2322, content: 'const invalid: string = api.computedObject.asserted.anything\nvoid invalid' },
    ],
  },
  'NUL and unpaired UTF-16 units in cooked template keys': {
    source: "export const computedObject = { [`nul\\0key`]: 7, [`a\\uD800b`]: true, [`a\\uD83D\\uDE00`]: 'emoji' }\n",
    positive: "const nul: number = api.computedObject['nul\\0key']\nconst lone: boolean = api.computedObject['a\\uD800b']\nconst paired: string = api.computedObject['a😀']\nvoid [nul, lone, paired]",
    negatives: [
      { code: 2322, content: "const invalid: string = api.computedObject['nul\\0key']\nvoid invalid" },
      { code: 2322, content: "const invalid: string = api.computedObject['a\\uD800b']\nvoid invalid" },
    ],
  },
  'symbol property values outside a computed string index': {
    source: "const WIDE: string = 'key'\nconst UNIQUE: unique symbol = Symbol('key')\nexport const exposedSymbol: typeof UNIQUE = UNIQUE\nexport const computedObject = { stable: true, [`prefix_${WIDE}`]: 7, [UNIQUE]: 'symbol' }\n",
    positive: 'const indexed: number | boolean = api.computedObject.anything\nconst symbol: string = api.computedObject[api.exposedSymbol]\nvoid [indexed, symbol]',
    negatives: [
      { code: 2322, content: 'const invalid: string = api.computedObject.anything\nvoid invalid' },
      { code: 2322, content: 'const invalid: number = api.computedObject[api.exposedSymbol]\nvoid invalid' },
    ],
  },
  'computed generic methods and identifier accessors': {
    source: "const KEY = 'field'\nlet current = 7\nexport const computedObject = { [`method_${KEY}`]<T>(value: T): T { return value }, get [KEY](): number { return current }, set [KEY](value: number) { current = value } }\n",
    positive: "const generic: string = api.computedObject.method_field('valid')\nconst current: number = api.computedObject.field\napi.computedObject.field = 8\nvoid [generic, current]",
    negatives: [
      { code: 2322, content: 'const invalid: number = api.computedObject.method_field(true)\nvoid invalid' },
      { code: 2322, content: "api.computedObject.field = 'invalid'" },
    ],
  },
  'spread properties without inventing an index for unknown computed keys': {
    source: "const WIDE: string = 'key'\nconst base = { name: 'base', count: 1 }\nexport const computedObject = { ...base, active: true, [`prefix_${WIDE}`]: 7 }\n",
    positive: 'const name: string = api.computedObject.name\nconst count: number = api.computedObject.count\nconst active: boolean = api.computedObject.active\nvoid [name, count, active]',
    negatives: [
      { code: 2322, content: 'const invalid: number = api.computedObject.name\nvoid invalid' },
      { code: 2322, content: "const invalid: keyof typeof api.computedObject = 'anything'\nvoid invalid" },
    ],
  },
  'numeric template strings without changing numeric literal key identity': {
    source: 'export const computedObject = { [`${7}`]: true, [3]: 1 }\n',
    positive: "const stringKey: keyof typeof api.computedObject = '7'\nconst numericKey: keyof typeof api.computedObject = 3\nconst value: boolean = api.computedObject['7']\nvoid [stringKey, numericKey, value]",
    negatives: [
      { code: 2322, content: 'const invalid: keyof typeof api.computedObject = 7\nvoid invalid' },
      { code: 2322, content: 'const invalid: number = api.computedObject[7]\nvoid invalid' },
    ],
  },
  'computed accessor omission without inventing exported property names': {
    source: "const KEY = 'field'\nexport const computedObject = { get [`plain`](): number { return 7 }, get [`prefix_${KEY}`](): number { return 7 } }\n",
    positive: "const plain: number = api.computedObject.plain\nconst key: keyof typeof api.computedObject = 'plain'\nvoid [plain, key]",
    negatives: [
      { code: 2339, content: 'void api.computedObject.prefix_field' },
      { code: 2540, content: 'api.computedObject.plain = 7' },
    ],
  },
  'comment terminator data inside computed property defaults': {
    source: "const KEY = 'field'\nexport const computedObject = { [`prefix_${KEY}`]: '*/', other: 'literal */ text' }\n",
    positive: 'const value: string = api.computedObject.prefix_field\nconst other: string = api.computedObject.other\nvoid [value, other]',
    negatives: [
      { code: 2322, content: 'const invalid: number = api.computedObject.prefix_field\nvoid invalid' },
      { code: 2322, content: "const invalid: keyof typeof api.computedObject = 'absent'\nvoid invalid" },
    ],
  },
}

test('ordinary TypeScript declaration emit gives the minimal computed object two exact named properties', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-computed-key-reference-'))
  try {
    await writeFile(join(directory, 'index.ts'), cases['private string bindings in template-computed keys'].source)
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], declaration: true, emitDeclarationOnly: true, outDir: './dist' }, files: ['index.ts'] }))
    const compiler = resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js')
    const result = Bun.spawnSync([process.execPath, compiler, '--project', 'tsconfig.json'], { cwd: directory, timeout: 4000 })
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
    const declaration = await readFile(join(directory, 'dist/index.d.ts'), 'utf8')
    expect(declaration).toMatch(/computedObject:\s*\{\s*dynamicProperty: string;\s*prefix_dynamicProperty: string;\s*\};/)
    expect(declaration).not.toContain('[x: string]')
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('incremental generation discards prior computed-key declarations and rechecks the public contract', async () => {
  expect(isAvailable).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-computed-key-cache-'))
  try {
    await mkdir(join(directory, 'src'))
    await mkdir(join(directory, 'dist'))
    const source = cases['private string bindings in template-computed keys'].source
    const file = join(directory, 'src/index.ts')
    await writeFile(file, source)
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
    const config = { ...defaultConfig, cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'], incremental: true, isolatedDeclarations: false, moduleSpecifierMode: 'node' as const }
    const plan = await planDeclarationProject(config)
    const cache = new BuildCache(config, plan.getResolutionFingerprint())
    const previous = "declare const COMPUTED_KEY: 'dynamicProperty';\nexport declare const computedObject: { [COMPUTED_KEY]: string; [`prefix_${COMPUTED_KEY}`]: string };\nexport {};\n"
    cache.update(file, source, previous, directory)
    cache.save()
    const matching = new BuildCache(config, plan.getResolutionFingerprint())
    expect(matching.load()).toBe(true)
    expect(matching.getCachedIfValid(file, directory)).toBe(previous)
    // Matching prior-format bytes exercise invalidation; they are a fixture,
    // not a claim about an historical SDK archive or release qualification.
    const manifestFile = join(directory, '.dtsx-cache/manifest.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    await writeFile(manifestFile, JSON.stringify({ ...manifest, version: 7 }))
    await writeFile(join(directory, 'dist/index.d.ts'), previous)
    const generated = await generate(config)
    expect(generated.filesGenerated).toBe(1)
    await writeFile(join(directory, 'tsconfig.consumer.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
    await writeFile(join(directory, 'consumer.ts'), "import { computedObject } from './dist/index.js'\nconst value: string = computedObject.prefix_dynamicProperty\nvoid value\n")
    const positive = runTsc(directory, ['--project', 'tsconfig.consumer.json'])
    expect(positive.ok, positive.output).toBe(true)
    await writeFile(join(directory, 'consumer.ts'), "import { computedObject } from './dist/index.js'\nconst invalid: keyof typeof computedObject = 'absent'\nvoid invalid\n")
    const negative = runTsc(directory, ['--project', 'tsconfig.consumer.json'])
    expect(negative.ok, negative.output).toBe(false)
    expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

for (const producer of ['core', 'bun-plugin', 'native'] as const) {
  for (const [name, fixture] of Object.entries(cases)) {
    test(`${producer} preserves ${name} in a strict installed package`, () => checkDeclarationPackage(producer, fixture))
  }
}

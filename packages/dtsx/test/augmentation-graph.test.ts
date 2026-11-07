import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planAugmentationImports, scanModuleAugmentations } from '../src/augmentation-graph'
import { resolveRelativeSpecifier } from '../src/module-graph'

const parent = "import { install } from './child.js'; export class ParentThing implements ParentThing {} install(ParentThing.prototype);"
const child = "import type { ParentThing } from './parent.js'; declare module './parent.js' { interface ParentThing { add: (a: number, b: number) => number } } export function install(target: ParentThing): void { target.add = (a: number, b: number) => a + b }"

async function plan(files: Record<string, string>, inspect: (result: Record<string, string[]>) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dtsx-augmentation-graph-'))
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(join(root, name, '..'), { recursive: true })
      await writeFile(join(root, name), source)
    }
    const result = await planAugmentationImports(Object.keys(files).map(name => join(root, name)), resolveRelativeSpecifier)
    inspect(Object.fromEntries([...result].map(([file, specifiers]) => [file.slice(root.length + 1), [...specifiers].sort()])))
  }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('augmentation syntax distinguishes ambient definitions, data and nested scopes', () => {
  expect(scanModuleAugmentations("declare module 'ambient' { export interface A {} }")).toEqual([])
  expect(scanModuleAugmentations(`export {}; const literal = "declare module './literal' {}";
    const template = \`declare module './template' {}\`;
    // declare module './comment' {}
    function nested() { const value = { module: './nested' }; }
    declare /* comment */ module '\\u002e/actual.js' { interface Added {} }
  `)).toEqual(['./actual.js'])
})

test('an unused runtime binding retains the local augmentation provider as an import path', () => plan({ 'parent.ts': parent, 'child.ts': child }, result => {
  expect(result).toEqual({ 'parent.ts': ['./child.js'] })
}))

test('transitive activation retains the complete path to its augmentation provider', () => plan({
  'parent.ts': parent.replace('./child.js', './bridge.js'),
  'bridge.ts': "import { install as apply } from './child.js'; import type { ParentThing } from './parent.js'; export function install(target: ParentThing): void { apply(target) }",
  'child.ts': child,
}, result => {
  expect(result['parent.ts']).toEqual(['./bridge.js'])
  expect(result['bridge.ts']).toEqual(['./child.js'])
}))

test('a return type can make another module augmentation part of the public graph', () => plan({
  'index.ts': "import type { ParentThing } from './parent.js'; import { install } from './child.js'; export function update(target: ParentThing): ParentThing { install(target); return target }",
  'parent.ts': 'export interface ParentThing {}',
  'child.ts': child,
}, result => {
  expect(result['index.ts']).toEqual(['./child.js'])
}))

test('cycles cannot retain an unrelated runtime import that merely leads back to the owner', () => plan({
  'parent.ts': "import { unrelated } from './cycle.js'; " + parent + ' unrelated();',
  'cycle.ts': "import type { ParentThing } from './parent.js'; export function unrelated(value?: ParentThing): void { void value }",
  'child.ts': child,
}, result => {
  expect(result['parent.ts']).toEqual(['./child.js'])
}))

test('augmentations of unrelated modules do not preserve an otherwise unused import', () => plan({
  'parent.ts': "import { unrelated } from './other.js'; " + parent + ' unrelated();',
  'child.ts': child,
  'other.ts': "import type { Other } from './unrelated.js'; declare module './unrelated.js' { interface Other { label: string } } export function unrelated(): void {}",
  'unrelated.ts': 'export interface Other {}',
}, result => {
  expect(result['parent.ts']).toEqual(['./child.js'])
}))

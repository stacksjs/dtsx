import type { PrivatePackageFixture } from './private-package'

export const privatePackageFixtures: Record<string, PrivatePackageFixture> = {
  'outer signature value scopes through nested arrow returns': {
    files: { 'index.ts': 'function Marker(value: number): number { return value }\nexport type Factory = (Marker: string) => () => typeof Marker\nexport function createFactory(Marker: string): () => typeof Marker { return () => Marker }\n' },
    positive: "import { createFactory, type Factory } from 'PRIVATE_LIBRARY'\ndeclare const factory: Factory\nconst fromType: string = factory('first')()\nconst fromFunction: string = createFactory('second')()\nvoid [fromType, fromFunction]\n",
    negatives: ["import { createFactory } from 'PRIVATE_LIBRARY'\nconst invalid: number = createFactory('second')()\nvoid invalid\n", "import type { Factory } from 'PRIVATE_LIBRARY'\ndeclare const factory: Factory\nconst invalid: number = factory('first')()\nvoid invalid\n"],
    pruned: { 'index.d.ts': ['function Marker'] },
  },
  'an alias narrowed before a later mutable write': {
    files: { 'index.ts': 'let privateValue: number | undefined = 7\nexport const value = privateValue\nprivateValue = undefined\n' },
    positive: "import { value } from 'PRIVATE_LIBRARY'\nconst number: number = value\nvoid number\n",
    negatives: ["import { value } from 'PRIVATE_LIBRARY'\nconst invalid: undefined = value\nvoid invalid\n", "import { value } from 'PRIVATE_LIBRARY'\nconst invalid: 7 = value\nvoid invalid\n"],
  },
  'an alias narrowed from an explicitly wider const declaration': {
    files: { 'index.ts': 'const privateValue: number | undefined = 7\nexport const value = privateValue\n' },
    positive: "import { value } from 'PRIVATE_LIBRARY'\nconst number: number = value\nvoid number\n",
    negatives: ["import { value } from 'PRIVATE_LIBRARY'\nconst invalid: undefined = value\nvoid invalid\n", "import { value } from 'PRIVATE_LIBRARY'\nconst invalid: 7 = value\nvoid invalid\n"],
  },
  'an alias narrowed by a preceding mutable write': {
    files: { 'index.ts': 'let privateValue: number | undefined = 7\nprivateValue = undefined\nexport const value = privateValue\n' },
    positive: "import { value } from 'PRIVATE_LIBRARY'\nconst missing: undefined = value\nvoid missing\n",
    negatives: ["import { value } from 'PRIVATE_LIBRARY'\nconst invalid: number = value\nvoid invalid\n", "import { value } from 'PRIVATE_LIBRARY'\nconst invalid: null = value\nvoid invalid\n"],
  },
  'a retained private namespace binding without named export leakage': {
    files: { 'index.ts': 'namespace Internal { export interface Options { scale: number } }\nexport interface Box { options: Internal.Options }\n' },
    positive: "import type { Box } from 'PRIVATE_LIBRARY'\nconst box: Box = { options: { scale: 7 } }\nvoid box\n",
    negatives: ["import type { Box } from 'PRIVATE_LIBRARY'\nconst invalid: Box = { options: { scale: 'wrong' } }\nvoid invalid\n", "import type { Internal } from 'PRIVATE_LIBRARY'\ntype Options = Internal.Options\n"],
    retained: { 'index.d.ts': ['namespace Internal'] },
  },
  'transitive inferred private function aliases': {
    files: { 'index.ts': 'function hiddenRequired(value: number): number { return value }\nconst privateAlias = hiddenRequired\nexport const callback = privateAlias\n' },
    positive: "import { callback } from 'PRIVATE_LIBRARY'\nconst value: number = callback(7)\nvoid value\n",
    negatives: ["import { callback } from 'PRIVATE_LIBRARY'\ncallback(true)\n"],
  },
  'a private primitive const alias without widening its literal': {
    files: { 'index.ts': 'const privateValue = 7\nexport const value = privateValue\n' },
    positive: "import { value } from 'PRIVATE_LIBRARY'\nconst exact: 7 = value\nvoid exact\n",
    negatives: ["import { value } from 'PRIVATE_LIBRARY'\nconst invalid: 8 = value\nvoid invalid\n"],
  },
  'an explicit inline callback type without retaining its implementation function': {
    files: { 'index.ts': 'function hiddenRequired(value: number): number { return value }\nexport const callback: (value: number) => number = hiddenRequired\n' },
    positive: "import { callback } from 'PRIVATE_LIBRARY'\nconst value: number = callback(7)\nvoid value\n",
    negatives: ["import { callback } from 'PRIVATE_LIBRARY'\ncallback(true)\n"],
    pruned: { 'index.d.ts': ['function hiddenRequired'] },
  },
  'script identity across regular expressions, template text and dynamic imports': {
    packageType: 'commonjs',
    moduleDetection: 'legacy',
    files: {
      'base.ts': 'export interface Unused { unused: true }\n',
      'index.ts': 'declare const settlementCount: number\nconst pattern = /[{}]export/\nconst template = `raw export { value } ${1}`\nvoid [pattern, template, import("./base.js")]\n',
    },
    positive: "import 'PRIVATE_LIBRARY'\nconst value: number = settlementCount\nvoid value\n",
    negatives: ["import 'PRIVATE_LIBRARY'\nconst invalid: string = settlementCount\nvoid invalid\n"],
    retained: { 'index.d.ts': ['declare const settlementCount'] },
    pruned: { 'index.d.ts': ['export {}'] },
  },
  'an inferred callback contract without implementation leakage': {
    files: { 'index.ts': 'function hiddenRequired(value: number): number { return value }\nexport const callback = hiddenRequired\n' },
    positive: "import { callback } from 'PRIVATE_LIBRARY'\nconst value: number = callback(7)\nvoid value\n",
    negatives: ["import { callback } from 'PRIVATE_LIBRARY'\ncallback(true)\n"],
  },
  'a signature parameter scope across earlier type queries': {
    files: { 'index.ts': 'function Marker(value: number): number { return value }\nexport type Callback = (value: typeof Marker, Marker: string) => typeof Marker\n' },
    positive: "import type { Callback } from 'PRIVATE_LIBRARY'\ndeclare const callback: Callback\nconst value: string = callback('first', 'second')\nvoid value\n",
    negatives: ["import type { Callback } from 'PRIVATE_LIBRARY'\ndeclare const callback: Callback\ncallback(7, 'second')\n"],
    pruned: { 'index.d.ts': ['function Marker'] },
  },
  'an object constructor result after arrow trivia': {
    files: { 'index.ts': 'function Factory<T>(): new () => /* result type */ { value: T } { return class { value!: T } }\nexport class Derived extends Factory<number>() {}\n' },
    positive: "import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived\nconst value: number = derived.value\nvoid value\n",
    negatives: ["import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived\nconst invalid: string = derived.value\nvoid invalid\n", "import { Factory } from 'PRIVATE_LIBRARY'\nvoid Factory\n"],
    retained: { 'index.d.ts': ['function Factory'] },
  },
  'an object callback result without retaining its implementation helper': {
    files: { 'index.ts': 'function implementationOnly(value: number): number { return value }\nexport function createFactory(): () => { value: number } { return () => ({ value: implementationOnly(7) }) }\n' },
    positive: "import { createFactory } from 'PRIVATE_LIBRARY'\nconst value: number = createFactory()().value\nvoid value\n",
    negatives: ["import { createFactory } from 'PRIVATE_LIBRARY'\nconst invalid: string = createFactory()().value\nvoid invalid\n"],
    pruned: { 'index.d.ts': ['function implementationOnly'] },
  },
  'an arrow-looking string literal return type': {
    files: { 'index.ts': "export function marker(): '=>' { return '=>' }\n" },
    positive: "import { marker } from 'PRIVATE_LIBRARY'\nconst value: '=>' = marker()\nvoid value\n",
    negatives: ["import { marker } from 'PRIVATE_LIBRARY'\nconst invalid: 'other' = marker()\nvoid invalid\n"],
  },
  'a true class heritage factory value reference': {
    files: { 'index.ts': 'function Factory<T>(): new () => { value: T } { return class { value!: T } }\nexport class Derived extends Factory<number>() {}\n' },
    positive: "import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived\nconst value: number = derived.value\nvoid value\n",
    negatives: ["import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived\nconst invalid: string = derived.value\nvoid invalid\n", "import { Factory } from 'PRIVATE_LIBRARY'\nvoid Factory\n"],
    retained: { 'index.d.ts': ['function Factory'] },
  },
  'a value query nested inside class heritage type arguments': {
    files: { 'index.ts': 'function Marker(value: number): number { return value }\nfunction Factory<T>(): new () => { value: T } { return class { value!: T } }\nexport class Derived extends Factory<typeof Marker>() {}\n' },
    positive: "import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived\nconst value: number = derived.value(7)\nvoid value\n",
    negatives: ["import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived\nderived.value(true)\n", "import { Marker } from 'PRIVATE_LIBRARY'\nvoid Marker\n"],
    retained: { 'index.d.ts': ['function Factory', 'function Marker'] },
  },
  'global augmentation after pruning the only import': {
    files: {
      'base.ts': 'export interface Unused { unused: true }\n',
      'index.ts': "import type { Unused } from './base.js'\ndeclare global { interface GlobalSettlement { scale: number } }\n",
    },
    positive: "import 'PRIVATE_LIBRARY'\nconst settlement: GlobalSettlement = { scale: 7 }\nvoid settlement\n",
    negatives: ["import 'PRIVATE_LIBRARY'\nconst invalid: GlobalSettlement = { scale: 'wrong' }\nvoid invalid\n"],
    pruned: { 'index.d.ts': ['Unused'] },
  },
  'relative augmentation after pruning the only import': {
    files: {
      'base.ts': 'export interface Unused { unused: true }\nexport interface Settlement { name: string }\n',
      'index.ts': "import type { Unused } from './base.js'\ndeclare module './base.js' { interface Settlement { scale: number } }\n",
    },
    positive: "import 'PRIVATE_LIBRARY'\nimport type { Settlement } from 'PRIVATE_BASE'\nconst settlement: Settlement = { name: 'home', scale: 7 }\nvoid settlement\n",
    negatives: ["import 'PRIVATE_LIBRARY'\nimport type { Settlement } from 'PRIVATE_BASE'\nconst invalid: Settlement = { name: 'home', scale: 'wrong' }\nvoid invalid\n"],
    pruned: { 'index.d.ts': ['Unused'] },
  },
  'ambient globals in a legacy CommonJS script': {
    packageType: 'commonjs',
    moduleDetection: 'legacy',
    files: { 'index.ts': 'declare const settlementCount: number\ndeclare let currentSettlement: string\ndeclare var activeSettlers: number\ndeclare function settlementName(id: number): string\n' },
    positive: "import 'PRIVATE_LIBRARY'\nconst count: number = settlementCount\nconst current: string = currentSettlement\nconst active: number = activeSettlers\nconst name: string = settlementName(7)\nvoid [count, current, active, name]\n",
    negatives: ["import 'PRIVATE_LIBRARY'\nsettlementName(true)\n", "import 'PRIVATE_LIBRARY'\nconst invalid: string = settlementCount\nvoid invalid\n"],
    retained: { 'index.d.ts': ['declare const settlementCount', 'declare let currentSettlement', 'declare var activeSettlers', 'declare function settlementName'] },
    pruned: { 'index.d.ts': ['export {}'] },
  },
  'an ambient external module without converting its script to an augmentation': {
    packageType: 'commonjs',
    moduleDetection: 'legacy',
    files: { 'index.ts': "declare module 'settlement-settings-contract' { export interface Settings { scale: number } }\n" },
    positive: "import 'PRIVATE_LIBRARY'\nimport type { Settings } from 'settlement-settings-contract'\nconst settings: Settings = { scale: 7 }\nvoid settings\n",
    negatives: ["import 'PRIVATE_LIBRARY'\nimport type { Settings } from 'settlement-settings-contract'\nconst invalid: Settings = { scale: 'wrong' }\nvoid invalid\n"],
    retained: { 'index.d.ts': ['declare module'] },
    pruned: { 'index.d.ts': ['export {}'] },
  },
  'class heritage type parameters without retaining a same-named function': {
    files: { 'index.ts': 'class Base<T> { value!: T }\nfunction GenericMarker(value: number): number { return value }\nexport class Derived<GenericMarker> extends Base<GenericMarker> {}\n' },
    positive: "import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived<number>\nconst value: number = derived.value\nvoid value\n",
    negatives: ["import type { Derived } from 'PRIVATE_LIBRARY'\ndeclare const derived: Derived<number>\nconst invalid: string = derived.value\nvoid invalid\n"],
    retained: { 'index.d.ts': ['class Base', 'class Derived'] },
    pruned: { 'index.d.ts': ['function GenericMarker'] },
  },
  'a genuine value query despite a same-named generic type parameter': {
    files: { 'index.ts': 'function Marker(value: number): number { return value }\nexport interface Box<Marker> { value: typeof Marker }\n' },
    positive: "import type { Box } from 'PRIVATE_LIBRARY'\ndeclare const box: Box<string>\nconst value: number = box.value(7)\nvoid value\n",
    negatives: ["import type { Box } from 'PRIVATE_LIBRARY'\ndeclare const box: Box<string>\nbox.value(true)\n", "import { Marker } from 'PRIVATE_LIBRARY'\nvoid Marker\n"],
    retained: { 'index.d.ts': ['function Marker'] },
  },
  'a local function-type value parameter without retaining the module function': {
    files: { 'index.ts': 'function Marker(value: number): number { return value }\nexport type Callback = (Marker: unknown) => typeof Marker\n' },
    positive: "import type { Callback } from 'PRIVATE_LIBRARY'\ndeclare const callback: Callback\nconst value: unknown = callback(7)\nvoid value\n",
    negatives: ["import type { Callback } from 'PRIVATE_LIBRARY'\ndeclare const callback: Callback\nconst invalid: number = callback(7)\nvoid invalid\n"],
    pruned: { 'index.d.ts': ['function Marker'] },
  },
  'a property name without exporting its private function through a star barrel': {
    files: {
      'optimizer.ts': 'function sortImports(value: number): number { return value }\nexport interface Options { sortImports?: boolean }\n',
      'sorter.ts': 'export function sortImports(value: string): string { return value }\n',
      'index.ts': "export * from './optimizer.js'\nexport * from './sorter.js'\n",
    },
    positive: "import { sortImports, type Options } from 'PRIVATE_LIBRARY'\nconst result: string = sortImports('valid')\nconst options: Options = { sortImports: true }\nvoid [result, options]\n",
    negatives: ["import { sortImports } from 'PRIVATE_LIBRARY'\nsortImports(7)\n"],
    pruned: { 'optimizer.d.ts': ['function sortImports'] },
  },
  'private ambient brand identity and visibility': {
    files: { 'index.ts': "declare const __brand: unique symbol\nexport type Id = string & { readonly [__brand]: 'id' }\n" },
    positive: "import type { Id } from 'PRIVATE_LIBRARY'\ndeclare const id: Id\nconst value: string = id\nvoid value\n",
    negatives: ["import type { Id } from 'PRIVATE_LIBRARY'\nconst invalid: Id = 'plain'\nvoid invalid\n", "import { __brand } from 'PRIVATE_LIBRARY'\nvoid __brand\n"],
    retained: { 'index.d.ts': ['declare const __brand: unique symbol'] },
  },
  'required private overloads without a named export leak': {
    files: { 'index.ts': 'function hiddenRequired(value: number): number\nfunction hiddenRequired(value: string): string\nfunction hiddenRequired(value: number | string): number | string { return value }\nexport const callback: typeof hiddenRequired = hiddenRequired\n' },
    positive: "import { callback } from 'PRIVATE_LIBRARY'\nconst number: number = callback(7)\nconst text: string = callback('valid')\nvoid [number, text]\n",
    negatives: ["import { callback } from 'PRIVATE_LIBRARY'\ncallback(true)\n", "import { hiddenRequired } from 'PRIVATE_LIBRARY'\nvoid hiddenRequired\n"],
    retained: { 'index.d.ts': ['function hiddenRequired(value: number): number', 'function hiddenRequired(value: string): string'] },
    pruned: { 'index.d.ts': ['function hiddenRequired(value: number | string)'] },
  },
}

for (const [name, alias] of [['comma', 'comma,name'], ['brace', '}'], ['empty', '']] as const) {
  for (const mode of ['value', 'clause-type', 'inline-type'] as const) {
    const quoted = JSON.stringify(alias)
    const statement = mode === 'clause-type' ? `export type { retained as ${quoted} }` : `export { ${mode === 'inline-type' ? 'type ' : ''}retained as ${quoted} }`
    const imported = `import { ${quoted} as binding } from 'PRIVATE_LIBRARY'\n`
    privatePackageFixtures[`${mode} local export with a quoted ${name} alias`] = {
      files: { 'index.ts': `function retained(value: number): number { return value }\n${statement}\n` },
      positive: `${imported}declare const callable: typeof binding\nconst value: number = callable(7)\nvoid value\n`,
      negatives: mode === 'value'
        ? [`${imported}binding(true)\n`, "import { retained } from 'PRIVATE_LIBRARY'\nvoid retained\n"]
        : [`${imported}binding(7)\n`, "import { retained } from 'PRIVATE_LIBRARY'\nvoid retained\n"],
      retained: { 'index.d.ts': ['function retained'] },
    }
  }
}

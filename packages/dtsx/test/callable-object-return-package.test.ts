import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

// #3146: an arrow result's object brace must not become the implementation brace.
interface CallableCase {
  name: string
  source: string
  positive: string
  negative: string
  negativeCode?: 2322 | 4104
}

const cases: CallableCase[] = [
  {
    name: 'generic constructor factory',
    source: 'function Factory<T>(): new () => { value: T } { return class { value!: T } }\nexport class Derived extends Factory<number>() {}',
    positive: 'const value: number = new api.Derived().value',
    negative: 'const value: string = new api.Derived().value',
  },
  {
    name: 'constructor factory with a value-query argument',
    source: 'class Marker { readonly marker: true = true }\nfunction Factory<T>(): new () => { value: T } { return class { value!: T } }\nexport class Derived extends Factory<typeof Marker>() {}',
    positive: 'const value: true = new (new api.Derived().value)().marker',
    negative: 'const value: false = new (new api.Derived().value)().marker',
  },
  {
    name: 'callback result after block-comment trivia',
    source: 'function implementationOnly(): number { return 1 }\nexport function factory(): (value: number) => /* object result */ { value: number } { implementationOnly(); return value => ({ value }) }',
    positive: 'const value: number = api.factory()(1).value',
    negative: 'const value: string = api.factory()(1).value',
  },
  {
    name: 'nested callback result after line-comment trivia',
    source: 'export function factory(): () => () => // object result\n { value: number } { return () => () => ({ value: 1 }) }',
    positive: 'const value: number = api.factory()()().value',
    negative: 'const value: string = api.factory()()().value',
  },
  {
    name: 'conditional callback object branches after comment trivia',
    source: 'export function factory<T>(): () => T extends string ? /* true branch */ { value: T } : // false branch\n { other: T } { throw new Error() }',
    positive: 'const text: string = api.factory<string>()().value; const numeric: number = api.factory<number>()().other',
    negative: 'const value: string = api.factory<number>()().other',
  },
  {
    name: 'keyof callback object operand after comment trivia',
    source: 'function implementationOnly(): number { return 1 }\nexport function factory(): () => keyof /* object keys */ { value: number } { implementationOnly(); return () => "value" }',
    positive: 'const value: "value" = api.factory()()',
    negative: 'const value: "other" = api.factory()()',
  },
  {
    name: 'readonly callback object-array operand after line-comment trivia',
    source: 'export function factory(): () => readonly // array elements\n { value: number }[] { return () => [] }',
    positive: 'const values: readonly { value: number }[] = api.factory()(); const value: number | undefined = values[0]?.value',
    negative: 'const values: { value: number }[] = api.factory()()',
    negativeCode: 4104,
  },
  {
    name: 'a contextual readonly value name and its following export',
    source: 'const readonly = 7; export const value = readonly\nexport const other = 3',
    positive: 'const value: 7 = api.value; const other: 3 = api.other',
    negative: 'const value: string = api.value',
  },
]

for (const fixture of cases) {
  for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
    test(`${producer} preserves ${fixture.name} in a strict installed package`, async () => {
      await checkDeclarationPackage(producer, {
        source: fixture.source,
        positive: fixture.positive,
        negatives: [{ code: fixture.negativeCode ?? 2322, content: fixture.negative }],
        inspect(declaration) {
          expect(declaration).not.toContain('implementationOnly')
          expect(declaration).not.toContain('return class')
        },
      })
    })
  }
}

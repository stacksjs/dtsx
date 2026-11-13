import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

// #3146: an arrow result's object brace must not become the implementation brace.
const cases = [
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
] as const

for (const fixture of cases) {
  for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
    test(`${producer} preserves ${fixture.name} in a strict installed package`, async () => {
      await checkDeclarationPackage(producer, {
        source: fixture.source,
        positive: fixture.positive,
        negatives: [{ code: 2322, content: fixture.negative }],
        inspect(declaration) {
          expect(declaration).not.toContain('implementationOnly')
          expect(declaration).not.toContain('return class')
        },
      })
    })
  }
}

import { test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
  for (const isolatedDeclarations of [false, true]) {
    test(`${producer} reads constructor trivia and literal arguments structurally (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `export class Store {
  values = new /* constructor */ Set/* arguments */<string>([')'])
  patterns = new Set<RegExp>([/\\(/])
}
export const values = new Set<string>([')'])
export function create() { return new Set<string>([')']) }`,
        positive: `const store = new api.Store();
const fields: Set<string> = store.values;
const patterns: Set<RegExp> = store.patterns;
const variable: Set<string> = api.values;
const returned: Set<string> = api.create();`,
        negatives: [
          { code: 2322, content: 'const wrong: Set<number> = new api.Store().values' },
          { code: 2322, content: 'const wrong: Set<number> = api.create()' },
        ],
      })
    })

    for (const split of [false, true]) {
      test(`${producer} preserves namespace augmentation of a constructor (merged=${split}, isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `export namespace Models {
  export class Item<T = string> { value!: T }
${split ? '}\nexport namespace Models {' : ''}
  export namespace Item { export const tag = 'item' }
  export class Store { item = new Item() }
}`,
          positive: 'const value: string = new api.Models.Store().item.value; const tag: string = api.Models.Item.tag;',
          negatives: [
            { code: 2322, content: 'const wrong: number = new api.Models.Store().item.value' },
            { code: 2339, content: 'const phantom = new api.Models.Store().item.tag' },
          ],
        })
      })
    }

    for (const fixture of [
      {
        name: 'exported values across merged namespaces',
        source: `class Box<T = number> { root!: T }
class Value<T> { value!: T }
export namespace Models { export const Box: typeof Value = Value }
export namespace Models { export class Store { item = new Box<string>() } }`,
        expression: 'new api.Models.Store().item',
        absent: 'root',
      },
      {
        name: 'nested namespace qualifier shadowing',
        source: `class Value<T> { value!: T }
namespace Models { export class Box<T> { wrong!: T } }
export namespace Local {
  export namespace Models { export const Box: typeof Value = Value }
  export class Store { item = new Models.Box<string>() }
}`,
        expression: 'new api.Local.Store().item',
        absent: 'wrong',
      },
      {
        name: 'private bindings stay local to their namespace block',
        source: `class Box<T = string> { value!: T }
class Value<T> { wrong!: T }
export namespace Models { const Box: typeof Value = Value }
export namespace Models { export class Store { item = new Box() } }`,
        expression: 'new api.Models.Store().item',
        absent: 'wrong',
      },
      {
        name: 'ambient namespace members export implicitly',
        source: `export declare namespace Models { class Item<T = string> { value: T } }
export namespace Models { export class Store { item = new Item() } }`,
        expression: 'new api.Models.Store().item',
        absent: 'wrong',
      },
    ]) {
      test(`${producer} resolves ${fixture.name} (isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: fixture.source,
          positive: `const value: string = (${fixture.expression}).value;`,
          negatives: [
            { code: 2322, content: `const wrong: number = (${fixture.expression}).value` },
            { code: 2339, content: `const phantom = (${fixture.expression}).${fixture.absent}` },
          ],
        })
      })
    }

    test(`${producer} retains lexical and qualified namespace constructors (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `export namespace Models {
  export class Store { item = new Item() }
  export class Token { private constructor() {} static readonly instance = new Models.Token() }
}
export namespace Models { export class Item<T = string> { value!: T } }`,
        positive: `const value: string = new api.Models.Store().item.value;
const token: api.Models.Token = api.Models.Token.instance;`,
        negatives: [{ code: 2322, content: 'const wrong: number = new api.Models.Store().item.value' }],
      })
    })

    test(`${producer} respects namespace constructor value shadowing (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `class Item { wrong = true }
class Value<T> { value!: T }
export namespace Models {
  const Item: typeof Value = Value
  export class Store { item = new Item<string>() }
}`,
        positive: 'const value: string = new api.Models.Store().item.value;',
        negatives: [{ code: 2322, content: 'const wrong: number = new api.Models.Store().item.value' }],
      })
    })

    test(`${producer} keeps authored names distinct from deferred inference slots (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: 'export const __dtsx_constructor_field_0__ = 7\nexport class Store { values = new Set<string>() }',
        positive: 'const value: 7 = api.__dtsx_constructor_field_0__; const values: Set<string> = new api.Store().values;',
        negatives: [{ code: 2322, content: 'const wrong: Set<number> = new api.Store().values' }],
      })
    })

    test(`${producer} resolves forward class and value constructor bindings before method inference (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `export class Store {
  box = new Box<string>()
  item = new Default()
  read() { return this.item }
}
const Box = class<T> { value?: T }
class Default<T = string> { value!: T }`,
        positive: `const store = new api.Store();
const box: { value?: string } = store.box;
const value: string = store.item.value;
const read: string = store.read().value;`,
        negatives: [
          { code: 2322, content: 'const wrong: number = new api.Store().item.value' },
          { code: 2322, content: 'const wrong: { value?: number } = new api.Store().box' },
        ],
      })
    })

    for (const visibility of ['private', 'protected']) {
      test(`${producer} preserves ${visibility} construction and defaulted class parameters (isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `export class Token<T = string> {
  ${visibility} constructor() {}
  value!: T
  static readonly instance = new Token<string>()
  static create() { return new Token<number>() }
}
class Default<T = string> { value!: T }
export class Store { item = new Default() }`,
          positive: `const token: api.Token<string> = api.Token.instance;
const created: api.Token<number> = api.Token.create();
const value: string = new api.Store().item.value;`,
          negatives: [
            { code: 2322, content: 'const wrong: number = new api.Store().item.value' },
            { code: 2322, content: 'const wrong: api.Token<string> = api.Token.create()' },
          ],
        })
      })
    }

    test(`${producer} retains an ambient constructor with unrelated private declarations (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: 'interface Unused {}\ndeclare class Entry { value: number }\nexport class Store { field = new Entry() }',
        positive: 'const value: number = new api.Store().field.value;',
        negatives: [{ code: 2339, content: 'const phantom = api.Entry' }],
      })
    })

    test(`${producer} preserves a generic Set field and its implemented contract (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: 'export interface Contract { readonly values: ReadonlySet<string> }\nexport class Store implements Contract { readonly values = new Set<string>() }',
        positive: `type IsAny<T> = 0 extends (1 & T) ? true : false;
const store = new api.Store();
const values: Set<string> = store.values;
values.add('later');
const contains: boolean = values.has('ok');
const safe: false = null as unknown as IsAny<typeof store.values>;
const exactKeys: [keyof typeof api] extends ['Store'] ? true : false = true;`,
        negatives: [
          { code: 2322, content: 'const wrong: Set<number> = new api.Store().values' },
          { code: 2339, content: 'const phantom = api.number' },
        ],
      })
    })

    test(`${producer} preserves Map fields, class parameters and private constructor types (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `class Entry<T> { constructor(public value: T) {} }
class Unused { readonly unused = true }
export class Store<T> {
  readonly entries = new Map<string, Entry<T>>()
  values = new Set<T>()
  static readonly labels = new Set<string>()
  static dates = new Map<string, Date>()
}`,
        positive: `type IsAny<T> = 0 extends (1 & T) ? true : false;
const store = new api.Store<number>();
const entries: Map<string, { value: number }> = store.entries;
const values: Set<number> = store.values;
store.values = new Set<number>();
const labels: Set<string> = api.Store.labels;
const dates: Map<string, Date> = api.Store.dates;
const safe: false = null as unknown as IsAny<NonNullable<ReturnType<typeof store.entries.get>>['value']>;
const exactKeys: [keyof typeof api] extends ['Store'] ? true : false = true;`,
        negatives: [
          { code: 2345, content: "new api.Store<number>().values.add('wrong')" },
          { code: 2322, content: "new api.Store<number>().entries.set('wrong', { value: 'wrong' })" },
          { code: 2339, content: 'const phantom = api.Unused' },
          { code: 2339, content: 'const privateType = api.Entry' },
        ],
        inspect: (declaration) => {
          if (/\bclass Unused\b/.test(declaration)) throw new Error('Unreachable private class retained')
        },
      })
    })

    for (const merge of ['interface Entry { extra?: string }', "namespace Entry { export const tag = 'entry' }"]) {
      test(`${producer} retains a reachable merged constructor (${merge.split(' ')[0]}, isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `class Entry { value = 1 }\n${merge}\nexport { Entry }`,
          positive: `const value: number = new api.Entry().value;
${merge.startsWith('namespace') ? 'const tag: string = api.Entry.tag;' : 'const extra: string | undefined = new api.Entry().extra;'}`,
          negatives: [{ code: 2339, content: 'const phantom = api.Entry.missing' }],
        })
      })
    }

    test(`${producer} preserves structural constructor arguments and value-only constructors (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `const Box = class<T> { value?: T }
export class Store {
  box = new Box<string>()
  handlers = new Set<(value: string) => number>()
  predicates = new Map<'>' | '<', (value: unknown) => value is string>()
}`,
        positive: `const store = new api.Store();
const box: { value?: string } = store.box;
const handlers: Set<(value: string) => number> = store.handlers;
const predicates: Map<'>' | '<', (value: unknown) => value is string> = store.predicates;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<typeof store.box>;
const exactKeys: [keyof typeof api] extends ['Store'] ? true : false = true;`,
        negatives: [
          { code: 2345, content: 'new api.Store().handlers.add((value: number) => value)' },
          { code: 2322, content: 'const wrong: { value?: number } = new api.Store().box' },
          { code: 2339, content: 'const privateConstructor = api.Box' },
        ],
      })
    })
  }
}

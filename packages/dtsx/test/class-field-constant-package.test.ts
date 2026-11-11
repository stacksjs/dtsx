import { test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
  for (const isolatedDeclarations of [false, true]) {
    test(`${producer} retains a class field's typed constant binding (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `type Operation = 'charge' | 'refund'
const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
export interface Driver { readonly capabilities: ReadonlySet<Operation> }
export class PaymentDriver implements Driver { readonly capabilities = CAPABILITIES }`,
        positive: `const driver = new api.PaymentDriver();
const contract: api.Driver = driver;
const supported: boolean = driver.capabilities.has('charge');
for (const value of driver.capabilities) { const operation: 'charge' | 'refund' = value; }
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<typeof driver.capabilities>;`,
        negatives: [
          { code: 2345, content: "new api.PaymentDriver().capabilities.has('not-an-operation')" },
          { code: 2339, content: "new api.PaymentDriver().capabilities.add('charge')" },
          { code: 2322, content: 'const wrong: ReadonlySet<number> = new api.PaymentDriver().capabilities' },
        ],
      })
    })

    for (const fixture of [
      {
        name: 'authored inference-marker-like constant',
        source: `type Operation = 'charge' | 'refund'
const __dtsx_constructor_field_0__: ReadonlySet<Operation> = new Set<Operation>(['charge'])
export class PaymentDriver { readonly capabilities = __dtsx_constructor_field_0__ }`,
        expression: 'new api.PaymentDriver()',
      },
      {
        name: 'namespace value shadowing',
        source: `const CAPABILITIES: ReadonlySet<'not-an-operation'> = new Set(['not-an-operation'])
export namespace Models {
  type Operation = 'charge' | 'refund'
  const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
  export class PaymentDriver { readonly capabilities = CAPABILITIES }
}`,
        expression: 'new api.Models.PaymentDriver()',
      },
      {
        name: 'forward annotated constant',
        source: `export class PaymentDriver { readonly capabilities = CAPABILITIES }
type Operation = 'charge' | 'refund'
const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])`,
        expression: 'new api.PaymentDriver()',
      },
      {
        name: 'private annotation dependency closure',
        source: `type Operation = 'charge' | 'refund'
const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
export class PaymentDriver { readonly capabilities = CAPABILITIES }`,
        expression: 'new api.PaymentDriver()',
      },
      {
        name: 'mutable field with an annotated value',
        source: `type Operation = 'charge' | 'refund'
const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
export class PaymentDriver { capabilities = CAPABILITIES }`,
        expression: 'new api.PaymentDriver()',
        assign: true,
      },
      {
        name: 'forward namespace constant',
        source: `export namespace Models {
  export class PaymentDriver { readonly capabilities = CAPABILITIES }
  type Operation = 'charge' | 'refund'
  const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
}`,
        expression: 'new api.Models.PaymentDriver()',
      },
      {
        name: 'outer constant with a shadowed annotation name',
        source: `export namespace Models {
  type Operation = 'charge' | 'refund'
  const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
  export namespace Inner {
    type Operation = 'different'
    export class PaymentDriver { readonly capabilities = CAPABILITIES }
  }
}`,
        expression: 'new api.Models.Inner.PaymentDriver()',
      },
    ]) {
      test(`${producer} resolves ${fixture.name} for a class field (isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: fixture.source,
          positive: `const driver = ${fixture.expression};
const capabilities: ReadonlySet<'charge' | 'refund'> = driver.capabilities;
const supported: boolean = driver.capabilities.has('charge');
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<typeof driver.capabilities>;
${fixture.assign ? "driver.capabilities = new Set<'charge' | 'refund'>(['refund']);" : ''}`,
          negatives: [
            { code: 2345, content: `(${fixture.expression}).capabilities.has('not-an-operation')` },
            { code: 2339, content: `(${fixture.expression}).capabilities.add('charge')` },
            { code: 2322, content: `const wrong: ReadonlySet<number> = (${fixture.expression}).capabilities` },
          ],
        })
      })
    }
  }
}

for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
  for (const isolatedDeclarations of [false, true]) {
    test(`${producer} retains a shared typed constant across 2048 class fields (isolated=${isolatedDeclarations})`, async () => {
      const classes = Array.from({ length: 2048 }, (_, index) => `export class Driver${index} { readonly capabilities = CAPABILITIES }`).join('\n')
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `type Operation = 'charge' | 'refund'
const CAPABILITIES: ReadonlySet<Operation> = new Set<Operation>(['charge'])
${classes}`,
        positive: `const first: ReadonlySet<'charge' | 'refund'> = new api.Driver0().capabilities;
const last: ReadonlySet<'charge' | 'refund'> = new api.Driver2047().capabilities;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<api.Driver2047['capabilities']>;`,
        negatives: [
          { code: 2345, content: "new api.Driver2047().capabilities.has('not-an-operation')" },
          { code: 2339, content: "new api.Driver0().capabilities.add('charge')" },
        ],
      })
    })
  }
}

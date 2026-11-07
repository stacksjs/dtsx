import { expect, test } from 'bun:test'
import type { DeclarationPackageCase } from './helpers/declaration-package'
import { checkDeclarationPackage } from './helpers/declaration-package'

const cases: Record<string, DeclarationPackageCase> = {
  'runtime numeric enum values': {
    source: 'const seed = Math.abs(-1); export enum E { Value = seed }',
    positive: 'const value: number = api.E.Value; void value',
    negatives: [{ code: 2322, content: 'const invalid: string = api.E.Value; void invalid' }],
    inspect: declaration => expect(declaration).not.toContain('seed'),
  },
  'runtime calls with structural commas and function bodies': {
    source: 'export enum E { Value = Math.max(1, 2), Other = (() => { return 3 })() }',
    positive: 'const values: number[] = [api.E.Value, api.E.Other]; void values',
    negatives: [{ code: 2322, content: 'const invalid: string = api.E.Other; void invalid' }],
  },
  'implicit numeric values': {
    source: 'export enum E { Zero, Next, Last }',
    positive: 'const zero: 0 = api.E.Zero; const next: 1 = api.E.Next; const last: 2 = api.E.Last; void [zero, next, last]',
    negatives: [{ code: 2322, content: 'const invalid: 1 = api.E.Zero; void invalid' }],
  },
  'an explicit reset after a runtime value': {
    source: 'export enum E { Value = Math.abs(-1), Reset = 7, After }',
    positive: 'const value: number = api.E.Value; const after: 8 = api.E.After; void [value, after]',
    negatives: [{ code: 2322, content: 'const invalid: 7 = api.E.After; void invalid' }],
  },
  'enum-local arithmetic and qualified references': {
    source: 'export enum E { A = 1 << 2, B = A | 1, C = E.B + 1, D }',
    positive: 'const a: 4 = api.E.A; const b: 5 = api.E.B; const c: 6 = api.E.C; const d: 7 = api.E.D; void [a, b, c, d]',
    negatives: [{ code: 2322, content: 'const invalid: 4 = api.E.D; void invalid' }],
  },
  'private source string constants': {
    source: 'const label = "value"; export enum E { Value = label, Alias = Value, Template = `prefix_${label}` }',
    positive: 'const value: "value" = api.E.Value; const alias: "value" = api.E.Alias; const template: "prefix_value" = api.E.Template; void [value, alias, template]',
    negatives: [{ code: 2322, content: 'const invalid: "wrong" = api.E.Value; void invalid' }],
    inspect: declaration => expect(declaration).not.toMatch(/declare const label/),
  },
  'private source numeric constants': {
    source: 'const seed = 7; export enum E { Value = seed, After }',
    positive: 'const value: 7 = api.E.Value; const after: 8 = api.E.After; void [value, after]',
    negatives: [{ code: 2322, content: 'const invalid: 7 = api.E.After; void invalid' }],
  },
  'prior enum string constants': {
    source: 'enum Previous { Value = "value" }; export enum E { Value = Previous.Value }',
    positive: 'const value: "value" = api.E.Value; void value',
    negatives: [{ code: 2322, content: 'const invalid: "wrong" = api.E.Value; void invalid' }],
  },
  'constant enum values': {
    source: 'export const enum E { A = 2 ** 3, B = A << 1, C }',
    positive: 'const a: 8 = api.E.A; const b: 16 = api.E.B; const c: 17 = api.E.C; void [a, b, c]',
    negatives: [{ code: 2322, content: 'const invalid: 8 = api.E.C; void invalid' }],
  },
  'ambient numeric members without inventing literal values': {
    source: 'export declare enum E { Value }',
    positive: 'const value: number = api.E.Value; void value',
    negatives: [{ code: 2322, content: 'const invalid: 0 = api.E.Value; void invalid' }],
  },
}

for (const producer of ['core', 'bun-plugin', 'native'] as const) {
  for (const [name, fixture] of Object.entries(cases))
    test(`${producer} preserves ${name} in a strict installed package`, () => checkDeclarationPackage(producer, fixture))
}

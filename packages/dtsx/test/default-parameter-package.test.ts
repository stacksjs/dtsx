import { test } from 'bun:test'
import type { DeclarationPackageCase } from './helpers/declaration-package'
import { checkDeclarationPackage } from './helpers/declaration-package'

function contract(source: string, call: string, wrongCall: string, missingCall?: string): DeclarationPackageCase {
  return {
    source,
    positive: `const value: number = ${call}\nvoid value`,
    negatives: [
      { code: 2322, content: `const invalid: string = ${call}\nvoid invalid` },
      { code: 2345, content: wrongCall },
      ...(missingCall ? [{ code: 2554, content: missingCall }] : []),
    ],
  }
}

const cases: Record<string, DeclarationPackageCase> = {
  'a default before a required parameter': contract(
    'export function sum(first: number = 1, last: number): number { return first + last }',
    'api.sum(undefined, 2)', 'api.sum("invalid", 2)', 'api.sum(1)',
  ),
  'a middle default and a trailing default': contract(
    'export function sum(lead: string, first: number = 1, last: number, tail: number = 1): number { return first + last + tail + lead.length }',
    'api.sum("lead", undefined, 2)', 'api.sum("lead", "invalid", 2)', 'api.sum("lead", 1)',
  ),
  'an arrow default before a required parameter': contract(
    'export const sum = (first: number = 1, last: number): number => first + last',
    'api.sum(undefined, 2)', 'api.sum("invalid", 2)', 'api.sum(1)',
  ),
  'a function expression default before a required parameter': contract(
    'export const sum = function(first: number = 1, last: number): number { return first + last }',
    'api.sum(undefined, 2)', 'api.sum("invalid", 2)', 'api.sum(1)',
  ),
  'an object method default before a required parameter': contract(
    'export const calculator = { sum(first: number = 1, last: number): number { return first + last } }',
    'api.calculator.sum(undefined, 2)', 'api.calculator.sum("invalid", 2)', 'api.calculator.sum(1)',
  ),
  'a class method default before a required parameter': contract(
    'export class Calculator { sum(first: number = 1, last: number): number { return first + last } }',
    'new api.Calculator().sum(undefined, 2)', 'new api.Calculator().sum("invalid", 2)', 'new api.Calculator().sum(1)',
  ),
  'a constructor default before a required parameter': contract(
    'export class Calculator { constructor(first: number = 1, last: number) { void [first, last] } value(): number { return 7 } }',
    'new api.Calculator(undefined, 2).value()', 'new api.Calculator("invalid", 2)', 'new api.Calculator(1)',
  ),
  'a function-typed default before a required parameter': contract(
    'export function sum(first: (value: number) => number = value => value, last: number): number { return first(last) }',
    'api.sum(undefined, 2)', 'api.sum("invalid", 2)', 'api.sum(value => value)',
  ),
  'a generic callback default before a required parameter': contract(
    'export function sum(first: <T>(value: T) => T = value => value, last: number): number { return first(last) }',
    'api.sum(undefined, 2)', 'api.sum("invalid", 2)', 'api.sum(value => value)',
  ),
  'a union default before a required parameter': contract(
    'export function sum(first: string | number = 1, last: number): number { return Number(first) + last }',
    'api.sum(undefined, 2)', 'api.sum(false, 2)', 'api.sum(1)',
  ),
  'an optional trailing default control': contract(
    'export function sum(first: number, last: number = 1): number { return first + last }',
    'api.sum(2)', 'api.sum("invalid")', 'api.sum()',
  ),
  'an optional default before an optional parameter control': contract(
    'export function sum(first: number = 1, last?: number): number { return first + (last ?? 0) }',
    'api.sum()', 'api.sum("invalid")',
  ),
  'an optional default before a rest parameter control': contract(
    'export function sum(first: number = 1, ...last: number[]): number { return first + last.length }',
    'api.sum()', 'api.sum("invalid")',
  ),
}

for (const producer of ['core', 'bun-plugin', 'native'] as const) {
  for (const [name, fixture] of Object.entries(cases))
    test(`${producer} preserves ${name} in a strict installed package`, () => checkDeclarationPackage(producer, fixture))
}

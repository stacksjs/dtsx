/**
 * An arrow type among a constructor's type arguments ended them early:
 *
 *   export const handlers = new Map<string, () => void>()
 *
 * emitted `Map<string, () =>`, which does not parse. `inferNewExpressionType`
 * matched the closing `>` itself and counted the `>` of `=>` as one. Vue's
 * `TransitionGroup` and knip's configuration hints are written this way.
 * A `<` or `>` in a string, template literal type or comment is not counted
 * either, or `(op: '<') => boolean` would leave one `<` open.
 */
import { describe, expect, it } from 'bun:test'
import { inferNarrowType } from '../src/processor'
import { processCode } from './test-utils'

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

describe('arrow types in constructor type arguments', () => {
  it.each([
    ['arrow type argument', 'export const handlers = new Map<string, () => void>()\n', 'handlers: Map<string, () => void>;'],
    ['arrow type nested in another type argument', 'export const listeners = new Map<string, Set<(event: Event) => void>>()\n', 'listeners: Map<string, Set<(event: Event) => void>>;'],
    ['arrow type returning a generic', 'export const cache = new WeakMap<object, (key: string) => Promise<number>>()\n', 'cache: WeakMap<object, (key: string) => Promise<number>>;'],
    ['generic arrow type', 'export const ids = new Map<string, <T>(x: T) => T>()\n', 'ids: Map<string, <T>(x: T) => T>;'],
    ['arrow type with a `<` in a string', 'export const callbacks = new Set<(operator: "<") => boolean>()\n', 'callbacks: Set<(operator: "<") => boolean>;'],
    ['arrow type and a `>` in a constructor argument', 'declare class Box<T> { value: T; constructor(label: string) }\nexport const value = new Box<(operator: "<") => boolean>("x >")\n', 'value: Box<(operator: "<") => boolean>;'],
    ['`<=>` inside a string type', 'export const operators = new Set<"<=>">()\n', 'operators: Set<"<=>">;'],
    ['`>` inside a string type', 'export const closers = new Set<\'>\'>()\n', 'closers: Set<\'>\'>;'],
    ['`<() =>` inside a string type', 'export const marks = new Set<"<() =>">()\n', 'marks: Set<"<() =>">;'],
    ['`<=>` inside a template literal type', 'export const ops = new Set<`${string}<=>${string}`>()\n', 'ops: Set<`${string}<=>${string}`>;'],
    ['`<(a) =>` inside a template literal type', 'export const arrows = new Set<`<(a) =>${string}`>()\n', 'arrows: Set<`<(a) =>${string}`>;'],
    ['nested template literal type', 'export const tags = new Set<`<${`${string}>`}`>()\n', 'tags: Set<`<${`${string}>`}`>;'],
    ['`//` in a nested template literal type', 'export const urls = new Set<`url(${`https://${string}`})`>()\n', 'urls: Set<`url(${`https://${string}`})`>;'],
    ['`>` after a line comment ended by a carriage return', 'export const nums = new Set<number // items\r>()\n', 'nums: Set<number // items\r>;'],
    ['`>` after a line comment ended by U+2028', 'export const nums = new Set<number // items\u2028>()\n', 'nums: Set<number // items\u2028>;'],
    ['`>` after a line comment ended by U+2029', 'export const nums = new Set<number // items\u2029>()\n', 'nums: Set<number // items\u2029>;'],
    ['`<() =>` inside a block comment', 'export const nums = new Set<number /* <() => */>()\n', 'nums: Set<number /* <() => */>;'],
    ['`>` in a constructor argument', 'declare class Box<T> { value: T; constructor(label: string) }\nexport const boxed = new Box<"<=>">("x >")\n', 'boxed: Box<"<=>">;'],
  ])('keeps the whole type: %s', (_label, code, expected) => {
    const output = processCode(code)
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain(expected)
  })

  it('reads deeply nested template literal types without recursing', () => {
    const type = `\`${'${`'.repeat(50_000)}x${'`}'.repeat(50_000)}\``
    expect(inferNarrowType(`new Set<${type}>()`)).toBe(`Set<${type}>`)
  })
})

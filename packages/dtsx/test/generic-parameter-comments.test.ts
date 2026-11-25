/**
 * A `//` comment inside a multi-line type parameter list commented out the rest
 * of the declaration. Multi-line `<...>` is collapsed onto one line, so
 *
 *   export function defineComponent<
 *     // props
 *     TypeProps,
 *     ...
 *   >(options: ...): ...
 *
 * came out as `defineComponent<// props TypeProps, ...` and everything after
 * the comment, closing `>` included, was gone. Vue's `defineComponent`,
 * vue-router's `RouteRecordInfo` and Pinia's store types are all written this
 * way; their `.d.ts` did not parse.
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

describe('comments in a multi-line type parameter list', () => {
  it.each([
    ['function', 'export function f<\n  // first\n  A,\n  B = string, // second\n>(a: A, b: B): void {}\n', 'f<A, B = string,>(a: A, b: B): void;'],
    ['type alias', 'export type T<\n  // note\n  A = 1,\n> = A\n', 'type T<A = 1,> = A'],
    ['interface', 'export interface I<\n  // note\n  A extends string = string,\n> { a: A }\n', 'interface I<A extends string = string,>'],
    ['class', 'export class C<\n  // note\n  T,\n> { v!: T }\n', 'class C<T,>'],
  ])('leaves the comment out: %s', (_label, code, expected) => {
    const output = processCode(code)
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain(expected)
    expect(output).not.toContain('//')
  })

  it('copies strings and block comments as they are', () => {
    const output = processCode('export type S<\n  /* see http://example.com */ A extends \'//\' | \'a  b\' = \'//\',\n> = A\n')
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain('/* see http://example.com */ A extends \'//\' | \'a  b\' = \'//\'')
  })

  it('keeps a multi-line template literal type as written', () => {
    const output = processCode('export type F<\n  // note\n  T = `a\nb`,\n> = T\n')
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain('T = `a\nb`')
  })
})

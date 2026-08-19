/**
 * A generator method kept its `*` in the emitted declaration:
 *
 *   export declare class BatchOperations {
 *     *getBatch<T>(keys: Key[]): AsyncGenerator<Record<string, T>>;
 *   }
 *
 * A `.d.ts` is an ambient context, where TypeScript rejects that outright with
 * TS1221 "Generators are not allowed in an ambient context". A syntax error in a
 * declaration file is not `skipLibCheck`-able, so one generator method took out
 * every type the package shipped.
 *
 * The `*` carries nothing the declaration needs - the return type is already
 * resolved to `Generator<...>` / `AsyncGenerator<...>` when the source did not
 * annotate one - so it is simply not emitted.
 *
 * Two paths emitted it: the hand-rolled scanner in `extractor/scanner.ts`, which
 * is the one that runs, and `buildClassDeclaration` in `extractor/builders.ts`.
 *
 * Surfaced from ts-cache, whose `dist/utils/index.d.ts` did not parse.
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

describe('generator methods in declarations', () => {
  it('drops the asterisk but keeps the annotated return type', () => {
    const dts = processCode(`
export class BatchOperations {
  async *getBatch<T>(keys: string[]): AsyncGenerator<Record<string, T>> {
    yield {} as Record<string, T>
  }
}
`)
    expect(dts).not.toContain('*getBatch')
    expect(dts).toContain('getBatch<T>(keys: string[]): AsyncGenerator<Record<string, T>>')
  })

  it('infers Generator for an unannotated generator, so nothing is lost', () => {
    const dts = processCode(`
export class Seq {
  *plain() {
    yield 1
  }
}
`)
    expect(dts).not.toContain('*plain')
    expect(dts).toContain('Generator<')
  })

  it('handles a symbol-named generator', () => {
    const dts = processCode(`
export class Iterable {
  *[Symbol.iterator]() {
    yield 1
  }
}
`)
    expect(dts).not.toContain('*[Symbol.iterator]')
    expect(dts).toContain('[Symbol.iterator]()')
  })

  it('leaves a standalone generator function alone, which is legal ambiently', () => {
    const dts = processCode(`
export function* counter(): Generator<number> {
  yield 1
}
`)
    // `declare function* f(): Generator<T>` is valid; only class members are not
    expect(dts).toContain('counter')
  })
})

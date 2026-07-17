import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

/**
 * Regression tests for invalid declaration shapes the generator used to emit.
 * Consumers (e.g. the Stacks build pipeline) previously had to repair these
 * with post-processing regexes:
 *
 *   - `method<T>: (value: T) => T`   (generic params glued to the property name)
 *   - `interface Requestextends Base` (missing separator before `extends`)
 *
 * Both are fixed at the source; these tests pin the valid shapes and assert
 * every generated declaration still parses as TypeScript.
 */

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

function expectValidTypeScript(output: string): void {
  expect(() => transpiler.transformSync(output)).not.toThrow()
}

describe('generic method shorthand in object literals', () => {
  it('moves type parameters onto the function type', () => {
    const output = processCode(`
export const Arr = {
  toArray<T>(value: T): T {
    return value
  },
}
`)
    expect(output).toContain('toArray: <T>(value: T) => T')
    expect(output).not.toMatch(/toArray<T>:\s*\(/)
    expectValidTypeScript(output)
  })

  it('moves constrained type parameters off async method keys', () => {
    const output = processCode(`
export const A = {
  async load<T extends { id: string }>(value: T): Promise<T> {
    return value
  },
}
`)
    expect(output).toContain('load: <T extends { id: string }>(value: T) => Promise<T>')
    expectValidTypeScript(output)
  })

  it('keeps multi-parameter generics with defaults intact', () => {
    const output = processCode(`
export const M = {
  merge<T, U = Partial<T>>(a: T, b: U): T & U {
    return { ...a, ...b }
  },
}
`)
    expect(output).toContain('merge: <T, U = Partial<T>>(a: T, b: U) => T & U')
    expectValidTypeScript(output)
  })

  it('handles arrow types inside generic constraints', () => {
    const output = processCode(`
export const C = {
  wrap<T extends () => void>(fn: T): T {
    return fn
  },
}
`)
    expect(output).toContain('wrap: <T extends () => void>(fn: T) => T')
    expectValidTypeScript(output)
  })

  it('handles quoted method names with type parameters', () => {
    const output = processCode(`
export const Q = {
  'my-key'<T>(value: T): T {
    return value
  },
}
`)
    expect(output).toContain(`'my-key': <T>(value: T) => T`)
    expectValidTypeScript(output)
  })

  it('leaves non-generic method shorthands untouched', () => {
    const output = processCode(`
export const P = {
  upper(value: string): string {
    return value.toUpperCase()
  },
}
`)
    expect(output).toContain('upper: (value: string) => string')
    expectValidTypeScript(output)
  })

  it('keeps generator method shorthands valid', () => {
    const output = processCode(`
export const G = {
  *ids(start: number): Generator<number, void, unknown> {
    yield start
  },
}
`)
    expect(output).toContain('ids: (start: number) => Generator<number, void, unknown>')
    expectValidTypeScript(output)
  })
})

describe('heritage clauses in ambient module bodies', () => {
  it('separates interface extends with a space in declare module', () => {
    const output = processCode(`
declare module 'pkg' {
  interface Request extends Base {}
}
export {}
`)
    expect(output).toContain('interface Request extends Base')
    expect(output).not.toMatch(/\binterface\s+\w+extends\b/)
    expectValidTypeScript(output)
  })

  it('separates interface extends with a space in namespaces', () => {
    const output = processCode(`
export namespace NS {
  interface Req extends Base {}
}
`)
    expect(output).toContain('interface Req extends Base')
    expectValidTypeScript(output)
  })

  it('separates interface extends with a space in declare global', () => {
    const output = processCode(`
declare global {
  interface Window extends Base {}
}
export {}
`)
    expect(output).toContain('interface Window extends Base')
    expectValidTypeScript(output)
  })

  it('keeps object type arguments in interface heritage clauses', () => {
    const output = processCode(`
declare module 'pkg' {
  interface Box extends Container<{ x: number }> {}
}
export {}
`)
    expect(output).toContain('interface Box extends Container<{ x: number }>')
    expectValidTypeScript(output)
  })

  it('keeps object type arguments in class heritage clauses', () => {
    const output = processCode(`
declare module 'pkg' {
  class Box extends Container<{ x: number }> {}
}
export {}
`)
    expect(output).toContain('class Box extends Container<{ x: number }>')
    expectValidTypeScript(output)
  })

  it('keeps abstract class heritage intact in ambient modules', () => {
    const output = processCode(`
declare module 'pkg' {
  abstract class Shape extends Base<Options, Flags> {}
}
export {}
`)
    expect(output).toContain('abstract class Shape extends Base<Options, Flags>')
    expectValidTypeScript(output)
  })

  it('keeps implements clauses in ambient class bodies', () => {
    const output = processCode(`
declare module 'pkg' {
  class Service extends Base implements Loggable, Serializable {}
}
export {}
`)
    expect(output).toContain('class Service extends Base implements Loggable, Serializable')
    expectValidTypeScript(output)
  })

  it('still handles plain class extends in ambient modules', () => {
    const output = processCode(`
declare module 'pkg' {
  class Foo extends Bar {}
}
export {}
`)
    expect(output).toContain('class Foo extends Bar')
    expectValidTypeScript(output)
  })
})

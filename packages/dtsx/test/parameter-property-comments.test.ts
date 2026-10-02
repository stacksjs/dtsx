import { describe, expect, it } from 'bun:test'
import { processSource } from '../src/process-source'

/**
 * A comment on a constructor parameter property used to be read as part of
 * the parameter. `/** ... *\/ public readonly body?: string` lost its
 * modifiers, the comment's prose was emitted as a class member, and the
 * parameter vanished from the constructor signature: a declaration file
 * TypeScript cannot parse, which no consumer can skipLibCheck past.
 */

function emit(source: string): string {
  return processSource(source, `parameter-property-${crypto.randomUUID()}.ts`)
}

function parses(dts: string): boolean {
  try {
    new Bun.Transpiler({ loader: 'ts' }).transformSync(dts)
    return true
  }
  catch {
    return false
  }
}

describe('constructor parameter properties with comments', () => {
  it('keeps a JSDoc-commented parameter property a member and a parameter', () => {
    const dts = emit(`
export class CatalogFetchError extends Error {
  constructor(
    public readonly url: string,
    message: string,
    public readonly status?: number,
    /** The start of the response body, when the server sent one with an error status. */
    public readonly body?: string,
  ) {
    super(message)
  }
}
`)

    expect(dts).toContain('public readonly body?: string;')
    expect(dts).toContain('constructor(url: string, message: string, status?: number, body?: string);')
    expect(dts).not.toContain('when the server sent one')
    expect(parses(dts)).toBe(true)
  })

  it('is not thrown by a quote or a comma inside a comment', () => {
    const dts = emit(`
export class Client {
  constructor(
    // the server's base URL, e.g. "https://a.b", without a trailing slash
    protected readonly baseUrl: string,
    /* retries, then gives up */ public retries = 3,
  ) {}
}
`)

    expect(dts).toContain('protected readonly baseUrl: string;')
    expect(dts).toContain('public retries')
    expect(parses(dts)).toBe(true)
  })

  it('leaves a string that looks like a comment alone', () => {
    const dts = emit(`
export class Route {
  constructor(public readonly pattern: string = '/api/*') {}
}
`)

    expect(dts).toContain('constructor(pattern?: string);')
    expect(parses(dts)).toBe(true)
  })

  // A default makes the parameter optional, never the property: the
  // initializer always assigns it, which is how TypeScript declares it.
  it('declares a defaulted parameter property as required', () => {
    const dts = emit(`
export class Route {
  constructor(
    public readonly pattern: string = '/api/*',
    public retries = 3,
    public onError: (reason?: string) => void = () => {},
    public timeout?: number,
  ) {}
}
`)

    expect(dts).toContain('public readonly pattern: string;')
    expect(dts).toContain('public retries: number;')
    expect(dts).toContain('public onError: (reason?: string) => void;')
    expect(dts).toContain('public timeout?: number;')
    expect(dts).toContain('constructor(pattern?: string, retries?: number, onError?: (reason?: string) => void, timeout?: number);')
    expect(parses(dts)).toBe(true)
  })
})

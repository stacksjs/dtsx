// Single-line namespace bodies: a member that ends at the closing brace,
// with no semicolon or newline, must not run past it and swallow what follows.
export namespace Config { export const port = 8080 }

export abstract class Service {
  abstract start(): void
}

export namespace Labels { export const greeting = 'hello' }

export namespace Counters { export let hits = 0 }

export namespace Shapes { export type Kind = 'circle' | 'square' }

export const version = '1.0.0'

export namespace Helpers { export function noop(): void {} }

export declare namespace Ambient { const flag: boolean }

export function ready(): boolean {
  return true
}

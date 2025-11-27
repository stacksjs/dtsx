// Test file for type-only import/export handling

// Type-only imports
import type { TypeA, TypeB } from './types'
import type DefaultType from './default-type'

// Mixed imports - value and type
import { valueFunction, type TypeC } from './mixed-module'

// Regular value imports
import { regularValue } from './values'

// Type-only re-exports
export type { TypeA, TypeB }
export type { TypeC as RenamedType }

// Mixed re-exports from module
export { valueFunction, type TypeD } from './other-module'

// Re-export all types
export type * from './all-types'

// Regular exports that use imported types
export function useTypes(a: TypeA, b: TypeB): TypeC {
  return {} as TypeC
}

// Interface using imported type
export interface Config {
  typeA: TypeA
  typeB: TypeB
  value: typeof regularValue
}

// Type alias using imported type
export type Combined = TypeA & TypeB

// Class using imported types
export class Handler {
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  process(input: TypeA): TypeB {
    return {} as TypeB
  }
}

// Default type usage
export const instance: DefaultType = {} as DefaultType

// Conditional type with imported types
export type Conditional<T> = T extends TypeA ? TypeB : TypeC

// Mapped type with imported types
export type Mapped = {
  [K in keyof TypeA]: TypeB
}

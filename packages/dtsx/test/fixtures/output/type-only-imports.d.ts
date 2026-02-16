import { regularValue } from './values';
import { valueFunction, type TypeC } from './mixed-module';
import type { TypeA, TypeB } from './types';
import type DefaultType from './default-type';
// Type-only re-exports
export type { TypeA, TypeB };
export type { TypeC as RenamedType };
export type * from './all-types';
// Regular exports that use imported types
export declare function useTypes(a: TypeA, b: TypeB): TypeC;
// Default type usage
export declare const instance: DefaultType;
// Interface using imported type
export declare interface Config {
  typeA: TypeA
  typeB: TypeB
  value: typeof regularValue
}
// Type alias using imported type
export type Combined = TypeA & TypeB;
// Conditional type with imported types
export type Conditional<T> = T extends TypeA ? TypeB : TypeC;
// Mapped type with imported types
export type Mapped = {
  [K in keyof TypeA]: TypeB
}
// Class using imported types
export declare class Handler {
  constructor(config: Config);
  process(input: TypeA): TypeB;
}
// Mixed re-exports from module
export { valueFunction, type TypeD } from './other-module';

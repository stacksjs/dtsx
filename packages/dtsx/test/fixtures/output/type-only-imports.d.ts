// Type-only imports should be preserved
import type { TypeA, TypeB } from './types';
import type DefaultType from './default-type';
import { valueFunction, type TypeC } from './mixed-module';
import { regularValue } from './values';

// Type-only re-exports
export type { TypeA, TypeB };
export type { TypeC as RenamedType };
export { valueFunction, type TypeD } from './other-module';
export type * from './all-types';

export declare function useTypes(a: TypeA, b: TypeB): TypeC;

export interface Config {
  typeA: TypeA;
  typeB: TypeB;
  value: typeof regularValue;
}

export type Combined = TypeA & TypeB;

export declare class Handler {
  private config: Config;
  constructor(config: Config);
  process(input: TypeA): TypeB;
}

export declare const instance: DefaultType;

export type Conditional<T> = T extends TypeA ? TypeB : TypeC;

export type Mapped = {
  [K in keyof TypeA]: TypeB;
};

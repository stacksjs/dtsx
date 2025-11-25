// Function with complex overloads
export declare function complexOverload(value: string): string;
export declare function complexOverload(value: number): number;
export declare function complexOverload(value: boolean): boolean;
export declare function complexOverload<T extends object>(value: T): T;
// Async generator function
export declare function asyncGenerator<T>(items: T[]): AsyncGenerator<T, void, unknown>;
// Test edge cases for type inference
// BigInt literals
export declare const bigIntLiteral: 123n;
export declare const bigIntExpression: bigint;
// Symbol types
export declare const symbolUnique: symbol;
export declare const symbolFor: symbol;
// Template literals
export declare const templateSimple: `Hello World`;
export declare const templateWithExpression: `Count: ${42}`;
export declare const templateTagged: string;
// Promise types
export declare const promiseResolved: Promise<42>;
export declare const promiseRejected: Promise<never>;
export declare const promiseAll: Promise<[1, 'two']>;
// Date and built-in types
export declare const dateInstance: Date;
export declare const mapInstance: Map<any, any>;
export declare const setInstance: Set<any>;
export declare const regexInstance: RegExp;
export declare const errorInstance: Error;
// Complex nested structures
export declare const deeplyNested: {
  level1: {
  level2: {
  level3: {
  value: 'deep';
  array: readonly [1, readonly [2, readonly [3, readonly [4]]]]
}
}
}
};
// Mixed type arrays
export declare const mixedTypeArray: readonly ['string', 123, true, null, undefined, {
  key: 'value'
}, readonly [1, 2, 3], (() => unknown), Date, Promise<'async'>];
// Type with conditional and infer
export type ExtractPromise<T> = T extends Promise<infer U> ? U : never
export type ExtractArray<T> = T extends (infer U)[] ? U : never
// Mapped type with template literal
export type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}
// Discriminated union
export type Result<T, E = Error> = | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E }
// Recursive type with constraints
export type DeepReadonly<T> = T extends any[] ? DeepReadonlyArray<T[number]> :
  T extends object ? DeepReadonlyObject<T> :
  T
declare type DeepReadonlyArray<T> = ReadonlyArray<DeepReadonly<T>>
declare type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>
}
// Class with decorators (as comments for now)
// @sealed
export declare class DecoratedClass {
  name: string;
  oldMethod(): void;
}
export declare function complexOverload(value: string): string;
export declare function complexOverload(value: number): number;
export declare function complexOverload(value: boolean): boolean;
export declare function complexOverload<T extends object>(value: T): T;
export declare function complexOverload(value: any): any;
export declare function asyncGenerator<T>(items: T[]): AsyncGenerator<T, void, unknown>;
export declare const bigIntLiteral: 123n;
export declare const bigIntExpression: bigint;
export declare const symbolUnique: symbol;
export declare const symbolFor: symbol;
export declare const templateSimple: `Hello World`;
export declare const templateWithExpression: `Count: ${42}`;
export declare const templateTagged: string;
export declare const promiseResolved: Promise<42>;
export declare const promiseRejected: Promise<never>;
export declare const promiseAll: Promise<[1, 'two']>;
export declare const dateInstance: Date;
export declare const mapInstance: Map<any, any>;
export declare const setInstance: Set<any>;
export declare const regexInstance: RegExp;
export declare const errorInstance: Error;
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
export declare const mixedTypeArray: readonly ['string', 123, true, null, undefined, {
  key: 'value'
}, readonly [1, 2, 3], (() => unknown), Date, Promise<'async'>];
export type ExtractPromise<T> = T extends Promise<infer U> ? U : never
export type ExtractArray<T> = T extends (infer U)[] ? U : never
export type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}
export type Result<T, E = Error> = | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E }
export type DeepReadonly<T> = T extends any[] ? DeepReadonlyArray<T[number]> :
  T extends object ? DeepReadonlyObject<T> :
  T
declare type DeepReadonlyArray<T> = ReadonlyArray<DeepReadonly<T>>
declare type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>
}
export declare class DecoratedClass {
  name: string;
  oldMethod(): void;
}
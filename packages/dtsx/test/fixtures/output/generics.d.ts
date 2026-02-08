// Generic edge cases
// Basic generic function
export declare function identity<T>(value: T): T;
// Multiple type parameters
export declare function mapPair<A, B, C>(pair: [A, B], fn: (a: A, b: B) => C): C;
// Constrained generics
export declare function getProperty<T, K extends keyof T>(obj: T, key: K): T[K];
// Default type parameter
export declare function createArray<T = string>(length: number, value: T): T[];
// Generic function with complex return type
export declare function createStore<S extends Record<string, unknown>>(initialState: S): {
  getState: () => Readonly<S>
  setState: (partial: Partial<S>) => void
  subscribe: (listener: (state: S) => void) => () => void
};
// Generic interface with methods that have their own generics
export declare interface Repository<T> {
  findById(id: string): Promise<T | null>
  findAll(): Promise<T[]>
  create(data: Partial<T>): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<boolean>
  query<Q extends keyof T>(field: Q, value: T[Q]): Promise<T[]>
  transform<U>(fn: (item: T) => U): Promise<U[]>
}
// Conditional types with generics
export type IsArray<T> = T extends any[] ? true : false;
export type Flatten<T> = T extends Array<infer U> ? Flatten<U> : T;
export type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T;
// Mapped type with generic constraint
export type Nullable<T extends object> = {
  [K in keyof T]: T[K] | null
}
// Generic type with multiple constraints
export type KeysMatching<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never
}[keyof T];
// Generic with intersection types
export type WithId<T> = T & { id: string }
export type WithTimestamps<T> = T & { createdAt: Date; updatedAt: Date }
export type Entity<T> = WithId<WithTimestamps<T>>;
// Generic class with constraints
export declare class TypedMap<K extends string | number, V> {
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  entries(): IterableIterator<[K, V]>;
}

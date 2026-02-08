// Generic edge cases

// Basic generic function
export function identity<T>(value: T): T {
  return value
}

// Multiple type parameters
export function mapPair<A, B, C>(pair: [A, B], fn: (a: A, b: B) => C): C {
  return fn(pair[0], pair[1])
}

// Constrained generics
export function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]
}

// Default type parameter
export function createArray<T = string>(length: number, value: T): T[] {
  return Array.from({ length }, () => value)
}

// Generic interface with methods that have their own generics
export interface Repository<T> {
  findById(id: string): Promise<T | null>
  findAll(): Promise<T[]>
  create(data: Partial<T>): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<boolean>
  query<Q extends keyof T>(field: Q, value: T[Q]): Promise<T[]>
  transform<U>(fn: (item: T) => U): Promise<U[]>
}

// Generic class with constraints
export class TypedMap<K extends string | number, V> {
  private map: Map<K, V> = new Map()

  set(key: K, value: V): this {
    this.map.set(key, value)
    return this
  }

  get(key: K): V | undefined {
    return this.map.get(key)
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries()
  }
}

// Conditional types with generics
export type IsArray<T> = T extends any[] ? true : false
export type Flatten<T> = T extends Array<infer U> ? Flatten<U> : T
export type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T

// Mapped type with generic constraint
export type Nullable<T extends object> = {
  [K in keyof T]: T[K] | null
}

// Generic type with multiple constraints
export type KeysMatching<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never
}[keyof T]

// Generic function with complex return type
export function createStore<S extends Record<string, unknown>>(
  initialState: S
): {
  getState: () => Readonly<S>
  setState: (partial: Partial<S>) => void
  subscribe: (listener: (state: S) => void) => () => void
} {
  let state = { ...initialState }
  const listeners = new Set<(state: S) => void>()
  return {
    getState: () => Object.freeze({ ...state }) as Readonly<S>,
    setState: (partial) => {
      state = { ...state, ...partial }
      listeners.forEach(l => l(state))
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// Generic with intersection types
export type WithId<T> = T & { id: string }
export type WithTimestamps<T> = T & { createdAt: Date; updatedAt: Date }
export type Entity<T> = WithId<WithTimestamps<T>>

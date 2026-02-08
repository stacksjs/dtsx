// Advanced TypeScript type features

// Conditional types
export type IsString<T> = T extends string ? true : false
export type IsFunction<T> = T extends (...args: any[]) => any ? true : false
export type NonNullable2<T> = T extends null | undefined ? never : T

// Infer in conditional types
export type ReturnType2<T> = T extends (...args: any[]) => infer R ? R : never
export type ParameterType<T> = T extends (arg: infer P) => any ? P : never
export type ConstructorParameters2<T> = T extends new (...args: infer P) => any ? P : never
export type InstanceType2<T> = T extends new (...args: any[]) => infer R ? R : never

// Template literal types
export type EventName<T extends string> = `on${Capitalize<T>}`
export type CSSProperty = `${string}-${string}`
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type APIRoute = `/${string}`
export type FullRoute = `${HTTPMethod} ${APIRoute}`

// Mapped types
export type Readonly2<T> = { readonly [K in keyof T]: T[K] }
export type Partial2<T> = { [K in keyof T]?: T[K] }
export type Required2<T> = { [K in keyof T]-?: T[K] }
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }

// Key remapping in mapped types
export type Getters2<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}
export type Setters<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void
}

// Recursive types
export type DeepPartial<T> = T extends object ? {
  [K in keyof T]?: DeepPartial<T[K]>
} : T

export type DeepRequired<T> = T extends object ? {
  [K in keyof T]-?: DeepRequired<T[K]>
} : T

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue }

// Discriminated unions
export type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'rectangle'; width: number; height: number }
  | { kind: 'triangle'; base: number; height: number }

// Utility function using complex types
export function processShape(shape: Shape): number {
  switch (shape.kind) {
    case 'circle': return Math.PI * shape.radius ** 2
    case 'rectangle': return shape.width * shape.height
    case 'triangle': return 0.5 * shape.base * shape.height
  }
}

// Tuple types
export type Pair<A, B> = [A, B]
export type Triple<A, B, C> = [A, B, C]
export type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never
export type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never
export type Length<T extends any[]> = T['length']

// Intersection types
export type Admin = {
  role: 'admin'
  permissions: string[]
}

export type UserProfile = {
  name: string
  email: string
}

export type AdminUser = Admin & UserProfile

// Index signatures
export interface StringMap {
  [key: string]: string
}

export interface NumberRecord {
  [key: string]: number
  total: number
}

// Branded types
export type Brand<T, B extends string> = T & { __brand: B }
export type USD = Brand<number, 'USD'>
export type EUR = Brand<number, 'EUR'>
export type Email = Brand<string, 'Email'>

// Variadic tuple types
export type Concat<A extends any[], B extends any[]> = [...A, ...B]
export type Prepend<T, A extends any[]> = [T, ...A]
export type Append<T, A extends any[]> = [...A, T]

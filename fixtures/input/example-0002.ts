/**
 * Extended test cases for DTS generation
 */

// 1. Complex Generic Types
export interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T
  key: K
  value: T[K]
  transform: (input: T[K]) => string
  nested: Array<Partial<T>>
}

// 2. Intersection and Union Types
export type ComplexUnionIntersection =
  | (User & { role: 'admin' })
  | (Product & { category: string })
  & {
    metadata: Record<string, unknown>
  }

// 3. Mapped and Conditional Types
export type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P]
}

export type ConditionalResponse<T> = T extends Array<infer U>
  ? ApiResponse<U[]>
  : T extends object
    ? ApiResponse<T>
    : ApiResponse<string>

// 4. Complex Function Overloads
export function processData(data: string): string
export function processData(data: number): number
export function processData(data: boolean): boolean
export function processData<T extends object>(data: T): T
export function processData(data: unknown): unknown {
  return data
}

// 5. Nested Object Types with Methods
export const complexObject = {
  handlers: {
    async onSuccess<T>(data: T): Promise<void> {
      console.log(data)
    },
    onError(error: Error & { code?: number }): never {
      throw error
    }
  },
  utils: {
    formatters: {
      date: (input: Date) => input.toISOString(),
      currency: (amount: number, currency = 'USD') =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    }
  }
}

// 6. Template Literal Types
export type EventType = 'click' | 'focus' | 'blur'
export type ElementType = 'button' | 'input' | 'form'
export type EventHandler = `on${Capitalize<EventType>}${Capitalize<ElementType>}`

// 7. Recursive Types
export type RecursiveObject = {
  id: string
  children?: RecursiveObject[]
  parent?: RecursiveObject
  metadata: Record<string, unknown>
}

// 8. Complex Array Types
export const complexArrays = {
  matrix: [
    [1, 2, [3, 4, [5, 6]]],
    ['a', 'b', ['c', 'd']],
    [true, [false, [true]]],
  ],
  tuples: [
    [1, 'string', true] as const,
    ['literal', 42, false] as const,
  ],
  mixedArrays: [
    new Date(),
    Promise.resolve('async'),
    async () => 'result',
    function* generator() { yield 42 },
  ]
}

// 9. Default Type Parameters
export interface DefaultGeneric<
  T = string,
  K extends keyof any = string,
  V extends Record<K, T> = Record<K, T>
> {
  key: K
  value: T
  record: V
}

// 10. Method Decorators and Metadata
export const methodDecorator = (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => {
  return {
    ...descriptor,
    enumerable: true,
  }
}

// 11. Complex Async Patterns
export async function* complexAsyncGenerator() {
  const results = await Promise.all([
    fetchUsers(),
    getProduct(1),
    authenticate('user', 'pass'),
  ])

  for (const result of results) {
    yield result
  }
}

// 12. Type Assertions and Guards
export function isUser(value: unknown): value is User {
  return (
    typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'email' in value
  )
}

// 13. Branded Types
export type UserId = string & { readonly __brand: unique symbol }
export type ProductId = number & { readonly __brand: unique symbol }

// 14. Complex Error Handling
export class CustomError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly metadata: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CustomError'
  }
}

// 15. Module Augmentation
declare module '@stacksjs/dtsx' {
  interface DtsGenerationConfig {
    customPlugins?: Array<{
      name: string
      transform: (code: string) => string
    }>
  }
}

// 16. Utility Type Implementations
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>
} : T

export type DeepRequired<T> = T extends object ? {
  [P in keyof T]-?: DeepRequired<T[P]>
} : T

// 17. Complex Constants with Type Inference
export const CONFIG_MAP = {
  development: {
    features: {
      auth: {
        providers: ['google', 'github'] as const,
        settings: { timeout: 5000, retries: 3 }
      }
    }
  },
  production: {
    features: {
      auth: {
        providers: ['google', 'github', 'microsoft'] as const,
        settings: { timeout: 3000, retries: 5 }
      }
    }
  }
} as const

// 18. Polymorphic Types
export type PolymorphicComponent<P = {}> = {
  <C extends React.ElementType>(
    props: { as?: C } & Omit<React.ComponentPropsWithRef<C>, keyof P> & P
  ): React.ReactElement | null
}

// 19. Type Inference in Functions
export function createApi<T extends Record<string, (...args: any[]) => any>>(
  endpoints: T
): { [K in keyof T]: ReturnType<T[K]> extends Promise<infer R> ? R : ReturnType<T[K]> } {
  return {} as any
}

// 20. Complex Index Types
export type DynamicRecord<K extends PropertyKey> = {
  [P in K]: P extends number
    ? Array<unknown>
    : P extends string
      ? Record<string, unknown>
      : never
}

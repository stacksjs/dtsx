import type { DtsGenerationOption } from '@stacksjs/dtsx'

export type AuthStatus = 'authenticated' | 'unauthenticated'

// Intersection and Union Types
export type ComplexUnionIntersection =
  | (User & { role: 'admin' })
  | (Product & { category: string })
  & {
    metadata: Record<string, unknown>
  }

export type { DtsGenerationOption }

// Mapped and Conditional Types
export type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P]
}

export type ConditionalResponse<T> = T extends Array<infer U>
  ? ApiResponse<U[]>
  : T extends object
    ? ApiResponse<T>
    : ApiResponse<string>

export type EventType = 'click' | 'focus' | 'blur'
export type ElementType = 'button' | 'input' | 'form'
export type EventHandler = `on${Capitalize<EventType>}${Capitalize<ElementType>}`

// Recursive Types
export type RecursiveObject = {
  id: string
  children?: RecursiveObject[]
  parent?: RecursiveObject
  metadata: Record<string, unknown>
}

// Branded Types
export type UserId = string & { readonly __brand: unique symbol }
export type ProductId = number & {
  readonly __brand: unique symbol
}

// Utility Type Implementations
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>
} : T

export type DeepRequired<T> = T extends object ? {
  [P in keyof T]-?: DeepRequired<T[P]>
} : T

// Polymorphic Types
export type PolymorphicComponent<P = {}> = {
  <C extends React.ElementType>(
    props: { as?: C } & Omit<React.ComponentPropsWithRef<C>, keyof P> & P
  ): React.ReactElement | null
}

// Complex Index Types
export type DynamicRecord<K extends PropertyKey> = {
  [P in K]: P extends number
    ? Array<unknown>
    : P extends string
      ? Record<string, unknown>
      : never
}

export type RecordMerge<T, U> = IsEmptyType<U> extends true
  ? T
  : [T, U] extends [any[], any[]]
      ? U
      : [T, U] extends [object, object]
          ? {
              [K in keyof T | keyof U]: K extends keyof T
                ? K extends keyof U
                  ? RecordMerge<T[K], U[K]>
                  : T[K]
                : K extends keyof U
                  ? U[K]
                  : never
            }
          : U

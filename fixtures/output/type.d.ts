import type { DtsGenerationOption } from '@stacksjs/dtsx';

export type { DtsGenerationOption };
export declare type AuthStatus = 'authenticated' | 'unauthenticated'

export type ComplexUnionIntersection =
  | (User & { role: 'admin' })
  | (Product & { category: string })
  & {
    metadata: Record<string, unknown>
  }
export declare type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P]
}
export declare type ConditionalResponse<T> = T extends Array<infer U>
  ? ApiResponse<U[]>
  : T extends object
    ? ApiResponse<T>
    : ApiResponse<string>
export declare type EventType = 'click' | 'focus' | 'blur'
export type ElementType = 'button' | 'input' | 'form'
export declare type EventHandler = `on${Capitalize<EventType>}${Capitalize<ElementType>}`

export type RecursiveObject = {
  id: string
  children?: RecursiveObject[]
  parent?: RecursiveObject
  metadata: Record<string, unknown>
}
export declare type UserId = string & { readonly __brand: unique symbol }
export type ProductId = number & {
  readonly __brand: unique symbol
}
export declare type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>
} : T
export declare type DeepRequired<T> = T extends object ? {
  [P in keyof T]-?: DeepRequired<T[P]>
} : T
export declare type PolymorphicComponent<P = {}> = {
  <C extends React.ElementType>(
    props: { as?: C } & Omit<React.ComponentPropsWithRef<C>, keyof P> & P
  ): React.ReactElement | null
}
export declare type DynamicRecord<K extends PropertyKey> = {
  [P in K]: P extends number
    ? Array<unknown>
    : P extends string
      ? Record<string, unknown>
      : never
}
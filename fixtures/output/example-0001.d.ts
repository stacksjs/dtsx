import type { BunPlugin } from 'bun'
import type { DtsGenerationConfig, DtsGenerationOption } from '@stacksjs/dtsx'
import { generate } from '@stacksjs/dtsx'

export declare const conf: { [key: string]: string };
export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: (...args: any[]) => unknown;
  anotherOne: (...args: any[]) => unknown;
  someArray: Array<1 | 2 | 3>;
  someNestedArray: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someNestedArray2: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value'>;
  someNestedArray3: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value' | Array<11 | 12 | 13>>;
  someOtherNestedArray: Array<Array<'some text' | 2 | unknown | ((...args: any[]) => unknown)> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someComplexArray: Array<Array<{ key: 'value' }> | Array<{ key2: 'value2' } | 'test' | 1000> | Array<'some string' | unknown>>;
  someObject: {
    key: 'value';
  };
  someNestedObject: {
    key: {
      nestedKey: 'value';
    };
    otherKey: {
      nestedKey: unknown;
      nestedKey2: (...args: any[]) => unknown;
    };
  };
};
export declare interface User {
  id: number
  name: string
  email: string
}
export declare interface ResponseData {
  success: boolean
  data: User[]
}
export declare function fetchUsers(): Promise<ResponseData>;
export declare interface ApiResponse<T> {
  status: number
  message: string
  data: T
}
declare const settings: { [key: string]: any };
export declare interface Product {
  id: number
  name: string
  price: number
}
export declare function getProduct(id: number): Promise<ApiResponse<Product>>;
export declare interface AuthResponse {
  token: string
  expiresIn: number
}
export declare type AuthStatus = 'authenticated' | 'unauthenticated';
export declare function authenticate(user: string, password: string): Promise<AuthResponse>;
export declare const defaultHeaders: {
  'Content-Type': 'application/json';
};
export declare function dts(options?: DtsGenerationOption): BunPlugin;
declare interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}
export declare function loadConfig<T extends Record<string, unknown>(): void;
declare const dtsConfig: DtsGenerationConfig;
export { generate, dtsConfig }
export type { DtsGenerationOption }
export { config } from './config'
export * from './extract'
export * from './generate'
export * from './types'
export * from './utils'
// 1. Complex Generic Types
export declare interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T
  key: K
  value: T[K]
  transform: (input: T[K]) => string
  nested: Array<Partial<T>>
}
export declare type ComplexUnionIntersection = 
  | (User & { role: 'admin' })
  | (Product & { category: string })
  & {
    metadata: Record<string, unknown>
  }

export default dts;

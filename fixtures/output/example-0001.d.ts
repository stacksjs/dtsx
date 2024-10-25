import type { BunPlugin } from 'bun'
import type { DtsGenerationConfig, DtsGenerationOption } from '@stacksjs/dtsx'
import { generate } from '@stacksjs/dtsx'

/**
 * Example of const declaration
 */
export const conf: { [key: string]: string } = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: '5000', // as string
}
export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: (...args: any[]) => void;
  anotherOne: (...args: any[]) => string;
  someArray: Array<1 | 2 | 3>;
  someNestedArray: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someNestedArray2: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value'>;
  someNestedArray3: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value' | Array<11 | 12 | 13>>;
  someOtherNestedArray: Array<Array<'some text' | 2 | ((...args: any[]) => void) | ((...args: any[]) => void) | unknown> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someComplexArray: Array<Array<{ key: 'value' }> | Array<{ key2: 'value2' } | 'test' | 1000> | Array<'some string' | ((...args: any[]) => void) | unknown>>;
  someObject: {
    key: 'value';
  };
  someNestedObject: {
    key: {
      nestedKey: 'value';
    };
    otherKey: {
      nestedKey: (...args: any[]) => void;
    };
  };
  someNestedObjectArray: Array<{ key: 'value' } | { key2: 'value2' }>;
  someOtherObject: unknown;
  someInlineCall2: (...args: any[]) => void;
  someInlineCall3: (...args: any[]) => void;
};
/**
 * Example of interface declaration
 * with another comment in an extra line
 */
export interface User {
  id: number
  name: string
  email: string
}
/**
 * Example of type declaration
 *
 * with multiple lines of comments, including an empty line
 */
export interface ResponseData {
  success: boolean
  data: User[]
}
/**
 * Example of function declaration
 *
 *
 * with multiple empty lines, including an empty lines
 */
export function fetchUsers(): Promise<ResponseData> {
  return fetch(conf.apiUrl)
    .then(response => response.json()) as Promise<ResponseData>
}
export declare interface ApiResponse<T> {
  status: number
  message: string
  data: T
}
/**
 * Example of another const declaration
    *
* with multiple empty lines, including being poorly formatted
 */
const settings: { [key: string]: any } = {
  theme: 'dark',
  language: 'en',
}
export declare interface Product {
  id: number
  name: string
  price: number
}
/**
 * Example of function declaration
 */
export function getProduct(id: number): Promise<ApiResponse<Product>> {
  return fetch(`${settings.apiUrl}/products/${id}`)
    .then(response => response.json()) as Promise<ApiResponse<Product>>
}
export declare interface AuthResponse {
  token: string
  expiresIn: number
}
export declare type AuthStatus = 'authenticated' | 'unauthenticated'
export function authenticate(user: string, password: string): Promise<AuthResponse> {
  return fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user, password }),
  }).then(response => response.json()) as Promise<AuthResponse>
}
export declare const defaultHeaders: {
  'Content-Type': 'application/json';
};
export declare function dts(options?: DtsGenerationOption): BunPlugin;
declare interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}
export declare function loadConfig<T extends Record<string, unknown>>(options: Options<T>): Promise<T>;
declare const dtsConfig: DtsGenerationConfig;

export { generate, dtsConfig }
export type { DtsGenerationOption }

export { config } from './config'

export * from './extract'
export * from './generate'

export * from './types'
export * from './utils'

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
export default dts

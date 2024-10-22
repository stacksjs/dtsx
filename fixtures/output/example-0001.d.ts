import type { BunPlugin } from 'bun';
/**
 * Example of const declaration
 */
export declare const conf: { [key: string]: string };
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
export declare interface User {
  id: number;
  name: string;
  email: string;
}
/**
 * Example of type declaration
 *
 * with multiple lines of comments, including an empty line
 */
export declare interface ResponseData {
  success: boolean;
  data: User[];
}
/**
 * Example of function declaration
 *
 *
 * with multiple empty lines, including an empty lines
 */
export declare function fetchUsers(): Promise<ResponseData>;
export declare interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}
/**
 * Example of another const declaration
 *
 * with multiple empty lines, including being poorly formatted
 */
declare const settings: { [key: string]: any };
export declare interface Product {
  id: number;
  name: string;
  price: number;
}
/**
 * Example of function declaration
 */
export declare function getProduct(id: number): Promise<ApiResponse<Product>>;
export declare interface AuthResponse {
  token: string;
  expiresIn: number;
}
export declare type AuthStatus = 'authenticated' | 'unauthenticated';
export declare function authenticate(user: string, password: string): Promise<AuthResponse>;
export declare const defaultHeaders: {
  'Content-Type': 'application/json';
};
export declare function dts(options?: DtsGenerationOption): BunPlugin;
declare interface Options<T> {
  name: string;
  cwd?: string;
  defaultConfig: T;
}
export declare async function loadConfig<T extends Record<string, unknown>>(): void;
declare const dtsConfig: DtsGenerationConfig;
export { generate, dtsConfig }
export declare type { DtsGenerationOption }
export { config } from './config'
export * from './extract'
export * from './generate'
export * from './types'
export * from './utils'
export default dts;

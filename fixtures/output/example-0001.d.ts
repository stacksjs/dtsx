import type { DtsGenerationOption, DtsGenerationConfig } from '@stacksjs/dtsx';
import type { BunPlugin } from 'bun';
import { generate } from '@stacksjs/dtsx';

/**
 * Example of const declaration
 */
export declare const conf: { [key: string]: string };

export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: Function;
  someFunction2: Function;
  someArray: [1, 2, 3];
  someNestedArray: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10]
  ];
  someComplexArray: [
    [{ key: 'value' }],
    [{ key2: 'value2' }, 'test', 1000],
    ['some string', Function, Function]
  ];
  someObject: { key: 'value' };
  someNestedObject: {
    key: {
      nestedKey: 'value';
    };
    otherKey: {
      nestedKey: Function;
      nestedKey2: Function;
    };
  };
  someNestedObjectArray: [
    { key: 'value' },
    { key2: 'value2' }
  ];
  someOtherObject: unknown;
  someInlineCall2: Function;
  someInlineCall3: Function;
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
declare const settings: {
  theme: 'dark';
  language: 'en';
}

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
  'Content-Type': string;
};

export declare function dts(options?: DtsGenerationOption): BunPlugin;

declare interface Options<T> {
  name: string;
  cwd?: string;
  defaultConfig: T;
}

export declare function loadConfig<T extends Record<string, unknown>>(options: Options<T>): Promise<T>;

declare const dtsConfig: {
  name: 'dts';
  cwd: process.cwd();
  defaultConfig: {
    root: './src';
    entrypoints: ['**/*.ts'];
    outdir: './dist',
    keepComments: true,
    clean: true,
    tsconfigPath: './tsconfig.json',
  },
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  tsconfigPath: './tsconfig.json',
}

// declare const dtsConfig: DtsGenerationConfig;

export { generate, dtsConfig };

export type { DtsGenerationOption };

export { config } from './config';
export * from './extract';
export * from './generate';
export * from './types';
export * from './utils';

export default dts;

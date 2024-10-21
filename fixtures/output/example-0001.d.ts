import type { DtsGenerationOption, DtsGenerationConfig } from '@stacksjs/dtsx';
import type { BunPlugin } from 'bun';

/**
 * Example of const declaration
 */
export declare const conf: {
  apiUrl: 'https://api.stacksjs.org';
  timeout: '5000';
};

export declare const someObject: {
  someString: string;
  someNumber: number;
};

/**
 * Example of interface declaration
 */
export declare interface User {
  id: number;
  name: string;
  email: string;
}

/**
 * Example of type declaration
 */
export declare interface ResponseData {
  success: boolean;
  data: User[];
}

/**
 * Example of function declaration
 */
export declare function fetchUsers(): Promise<ResponseData>;

export declare interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
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

interface Options<T> {
  name: string;
  cwd?: string;
  defaultConfig: T;
}

export declare function loadConfig<T extends Record<string, unknown>>(options: Options<T>): Promise<T>;

export declare const dtsConfig: DtsGenerationConfig;

export { generate } from '@stacksjs/dtsx';

export { config } from './config';
export * from './extract';
export * from './generate';
export * from './types';
export * from './utils';

export default dts;

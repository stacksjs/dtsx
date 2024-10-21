import type { DtsGenerationOption, DtsGenerationConfig } from '@stacksjs/dtsx';
import type { BunPlugin } from 'bun';

/**
 * Example of const declaration
 */
export const conf: { [key: string]: string };

export const someObject: {
  someString: string;
  someNumber: number;
};

/**
 * Example of interface declaration
 */
export interface User {
  id: number;
  name: string;
  email: string;
}

/**
 * Example of type declaration
 */
export interface ResponseData {
  success: boolean;
  data: User[];
}

/**
 * Example of function declaration
 */
export function fetchUsers(): Promise<ResponseData>;

export interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

export interface Product {
  id: number;
  name: string;
  price: number;
}

/**
 * Example of function declaration
 */
export function getProduct(id: number): Promise<ApiResponse<Product>>;

export interface AuthResponse {
  token: string;
  expiresIn: number;
}

export type AuthStatus = 'authenticated' | 'unauthenticated';

export function authenticate(user: string, password: string): Promise<AuthResponse>;

export const defaultHeaders: {
  'Content-Type': string;
};

export function dts(options?: DtsGenerationOption): BunPlugin;

interface Options<T> {
  name: string;
  cwd?: string;
  defaultConfig: T;
}

export function loadConfig<T extends Record<string, unknown>>(options: Options<T>): Promise<T>;

export const dtsConfig: DtsGenerationConfig;

export { generate } from '@stacksjs/dtsx';

export { config } from './config';
export * from './extract';
export * from './generate';
export * from './types';
export * from './utils';

export default dts;

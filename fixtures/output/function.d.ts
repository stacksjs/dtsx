import type { BunPlugin } from 'bun';
import type { DtsGenerationOption } from '@stacksjs/dtsx';

export declare function fetchUsers(): Promise<ResponseData>;
export declare function getProduct(id: number): Promise<ApiResponse<Product>>;
export declare function authenticate(user: string, password: string): Promise<AuthResponse>;
export declare function dts(options?: DtsGenerationOption): BunPlugin;
export declare function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: Options<T>): Promise<T>;
export declare function processData(data: string): string;
export declare function processData(data: number): number;
export declare function processData(data: boolean): boolean;
export declare function processData<T extends object>(data: T): T;
export declare function processData(data: unknown): unknown;
export declare function complexAsyncGenerator(): any;
export declare function isUser(value: unknown): value is User;
export declare function extractFunctionSignature(declaration: string): FunctionSignature;
export declare function createApi<T extends Record<string, (...args: any[]) => any>>(endpoints: T): { [K in keyof T]: ReturnType<T[K]> extends Promise<infer R> ? R : ReturnType<T[K]> };


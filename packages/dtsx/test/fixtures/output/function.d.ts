import type { BunPlugin } from 'bun';
import type { DtsGenerationOption } from '@stacksjs/dtsx';
/**
 * Example of function declaration
 *
 *
 * with multiple empty lines, including an empty lines
 */
export declare function fetchUsers(): Promise<ResponseData>;
/**
 * Example of function declaration
 */
export declare function getProduct(id: number): Promise<ApiResponse<Product>>;
export declare function authenticate(user: string, password: string): Promise<AuthResponse>;
export declare function dts(options?: DtsGenerationOption): BunPlugin;
export declare function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: Options<T>): Promise<T>;
// Complex Function Overloads
export declare function processData(data: string): string;
export declare function processData(data: number): number;
export declare function processData(data: boolean): boolean;
export declare function processData<T extends object>(data: T): T;
// Complex Async Patterns -> due to isolatedDeclarations, we can assume the return type here
export declare function complexAsyncGenerator(): any;
// Type Assertions and Guards
export declare function isUser(value: unknown): value is User;
/**
 * Extract complete function signature using regex
 */
export declare function extractFunctionSignature(declaration: string): FunctionSignature;
// Type Inference in Functions
export declare function createApi<T extends Record<string, (...args: any[]) => any>>(endpoints: T): { [K in keyof T]: ReturnType<T[K]> extends Promise<infer R> ? R : ReturnType<T[K]> };
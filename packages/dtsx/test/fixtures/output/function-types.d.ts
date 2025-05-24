// Function with optional and default parameters
export declare function withOptionalParams(required: string, optional?: number, defaultParam?: any): void;
// Function with rest parameters
export declare function withRestParams(first: string, ...rest: number[]): number;
// Function with destructured parameters
export declare function withDestructuredParams({ name, age, props }: {
  name: string
  age?: number
  [key: string]: any
}): void;
// Function with this parameter
export declare function withThisParam(this: { count: number }, increment: number): number;
// Function with type predicate
export declare function isString(value: unknown): value is string;
// Function with assertion signature
export declare function assertDefined<T>(value: T | undefined): asserts value is T;
// Generator function types
export declare function simpleGenerator(): Generator<number, void, unknown>;
// Arrow function variations
export declare const arrowSimple: () => 'simple';
export declare const arrowWithParams: (x: number, y: number) => unknown;
export declare const arrowAsync: (url: string) => Promise<unknown>;
export declare const arrowGeneric: <T extends object>(obj: T) => T;
// Higher order functions
export declare const createMultiplier: (factor: number) => (value: number) => any;
export declare const pipe: <T>(...fns: Array<(value: T) => T>) => (value: T) => T;
// Method decorator pattern
export declare const methodDecorator: (target: any, propertyKey: string, descriptor: PropertyDescriptor) => unknown;
export declare const generatorArrow: <T>(items: T[]) => Generator<T, void, unknown>;
// Constructor function
export declare interface ConstructorExample {
  new (name: string): { name: string }
  (name: string): string
}
// Various function types and signatures
// Function type aliases
export type SimpleFunction = () => void
export type ParameterizedFunction = (a: string, b: number) => boolean
export type GenericFunction = <T>(value: T) => T
export type AsyncFunction = (id: string) => Promise<unknown>
// Callback function type
export type CallbackFunction = (error: Error | null, result?: unknown) => void
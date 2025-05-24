export declare function withOptionalParams(required: string, optional?: number, defaultParam?: any): void;
export declare function withRestParams(first: string, ...rest: number[]): number;
export declare function withDestructuredParams({ name, age, props }: {
  name: string
  age?: number
  [key: string]: any
}): void;
export declare function withThisParam(this: { count: number }, increment: number): number;
export declare function isString(value: unknown): value is string;
export declare function assertDefined<T>(value: T | undefined): asserts value is T;
export declare function simpleGenerator(): Generator<number, void, unknown>;
export declare const arrowSimple: () => 'simple';
export declare const arrowWithParams: (x: number, y: number) => unknown;
export declare const arrowAsync: (url: string) => Promise<unknown>;
export declare const arrowGeneric: <T extends object>(obj: T) => T;
export declare const createMultiplier: (factor: number) => (value: number) => any;
export declare const pipe: <T>(...fns: Array<(value: T) => T>) => (value: T) => T;
export declare const methodDecorator: (target: any, propertyKey: string, descriptor: PropertyDescriptor) => unknown;
export declare const generatorArrow: <T>(items: T[]) => Generator<T, void, unknown>;
export declare interface ConstructorExample {
  new (name: string): { name: string }
  (name: string): string
}
export type SimpleFunction = () => void
export type ParameterizedFunction = (a: string, b: number) => boolean
export type GenericFunction = <T>(value: T) => T
export type AsyncFunction = (id: string) => Promise<unknown>
export type CallbackFunction = (error: Error | null, result?: unknown) => void
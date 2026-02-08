import { readFile, writeFile } from 'node:fs/promises';
import type { Buffer } from 'node:buffer';
export type { Buffer };
// Function overloads
export declare function parse(input: string): object;
export declare function parse(input: string, reviver: (key: string, value: any) => any): object;
// Type guard function
export declare function isString(value: unknown): value is string;
// Assertion function
export declare function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T;
// Default export
export declare function main(): void;
// Default export with named exports
export declare const VERSION: '2.0.0';
export declare const MAX_RETRIES: 3;
export declare const theme: Theme;
export type Options = {
  verbose: boolean
  timeout: number
}
// Const enum
export declare const enum Direction {
  Up = 'UP',
  Down = 'DOWN',
  Left = 'LEFT',
  Right = 'RIGHT',
}
// Namespace with types
export declare namespace Validators {
  export interface StringValidator {
  isValid(s: string): boolean
}
  export type ValidationResult = {
    valid: boolean
    errors: string[]
  }
  export function validate(value: string, validator: StringValidator): ValidationResult;
}
export { readFile as read, writeFile as write };
// Wildcard re-export
export * from './types';
// Export with type modifier
export { type Options as OptionsType };

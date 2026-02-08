// Mixed export patterns

// Re-exports with renaming
import { readFile, writeFile } from 'node:fs/promises'
import type { Buffer } from 'node:buffer'

export { readFile as read, writeFile as write }
export type { Buffer }

// Default export with named exports
export const VERSION = '2.0.0'
export const MAX_RETRIES = 3

export type Options = {
  verbose: boolean
  timeout: number
}

// Function overloads
export function parse(input: string): object
export function parse(input: string, reviver: (key: string, value: any) => any): object
export function parse(input: string, reviver?: (key: string, value: any) => any): object {
  return JSON.parse(input, reviver)
}

// Const enum
export const enum Direction {
  Up = 'UP',
  Down = 'DOWN',
  Left = 'LEFT',
  Right = 'RIGHT',
}

// Namespace with types
export namespace Validators {
  export interface StringValidator {
    isValid(s: string): boolean
  }

  export type ValidationResult = {
    valid: boolean
    errors: string[]
  }

  export function validate(value: string, validator: StringValidator): ValidationResult {
    return {
      valid: validator.isValid(value),
      errors: [],
    }
  }
}

// Type guard function
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

// Assertion function
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Value is null or undefined')
  }
}

// Complex const declaration with satisfies
interface Theme {
  colors: Record<string, string>
  spacing: Record<string, number>
}

export const theme = {
  colors: {
    primary: '#007bff',
    secondary: '#6c757d',
    success: '#28a745',
  },
  spacing: {
    small: 4,
    medium: 8,
    large: 16,
  },
} satisfies Theme

// Wildcard re-export
export * from './types'

// Export with type modifier
export { type Options as OptionsType }

// Default export
export default function main(): void {
  console.log('main')
}

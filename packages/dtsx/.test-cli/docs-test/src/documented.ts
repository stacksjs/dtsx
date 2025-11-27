/**
 * A well-documented function
 * @param name - The name to greet
 * @returns A greeting string
 * @example
 * greet('World') // returns 'Hello, World!'
 */
export function greet(name: string): string {
  return `Hello, ${name}!`
}

/**
 * User interface
 * @category Models
 */
export interface User {
  /** User's name */
  name: string
  /** User's age */
  age: number
}

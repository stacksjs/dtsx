# Type Support

dtsx provides comprehensive support for all TypeScript declaration types, ensuring that your generated `.d.ts` files accurately represent your source code's type information.

## Supported Declaration Types

### Interfaces

Full support for TypeScript interfaces with all features:

```typescript
// Source
export interface User<T = string> {
  /** User's unique identifier */
  id: T
  /** User's display name */
  name: string
  /** Optional email address */
  email?: string
  /** User preferences */
  preferences: {
    theme: 'light' | 'dark'
    notifications: boolean
  }
}

// Generated .d.ts
export interface User<T = string> {
  /** User's unique identifier */
  id: T
  /** User's display name */
  name: string
  /** Optional email address */
  email?: string
  /** User preferences */
  preferences: {
    theme: 'light' | 'dark'
    notifications: boolean
  }
}
```

**Supported Interface Features:**
- Generic type parameters with constraints and defaults
- Optional properties (`?`)
- Readonly properties
- Index signatures
- Method signatures
- Inheritance with `extends`
- JSDoc comment preservation

### Type Aliases

Complete support for type aliases including complex types:

```typescript
// Source
export type Status = 'pending' | 'approved' | 'rejected'

export type ApiResponse<T> = {
  data: T
  status: Status
  timestamp: Date
}

export type EventHandler<T extends Event = Event> = (event: T) => void

// Generated .d.ts
export type Status = 'pending' | 'approved' | 'rejected'
export type ApiResponse<T> = {
  data: T
  status: Status
  timestamp: Date
}
export type EventHandler<T extends Event = Event> = (event: T) => void
```

**Supported Type Features:**
- Union and intersection types
- Generic type parameters
- Conditional types
- Mapped types
- Template literal types
- Utility types

### Functions

Comprehensive function declaration support:

```typescript
// Source
/**
 * Processes user data with validation
 * @param user - The user object to process
 * @param options - Processing options
 * @returns Promise resolving to processed user
 * @example
 * const result = await processUser(user, { validate: true })
 */
export async function processUser<T extends User>(
  user: T,
  options: { validate?: boolean } = {}
): Promise<T & { processed: true }> {
  // implementation
}

// Generated .d.ts
/**
 * Processes user data with validation
 * @param user - The user object to process
 * @param options - Processing options
 * @returns Promise resolving to processed user
 * @example
 * const result = await processUser(user, { validate: true })
 */
export declare function processUser<T extends User>(
  user: T,
  options?: { validate?: boolean }
): Promise<T & { processed: true }>
```

**Supported Function Features:**
- Generic type parameters with constraints
- Optional parameters
- Default parameter values
- Rest parameters
- Async functions
- Generator functions
- Function overloads
- JSDoc preservation

### Classes

Full class declaration support with all TypeScript features:

```typescript
// Source
/**
 * Base user management class
 */
export abstract class BaseUserManager<T extends User = User> {
  protected users: Map<string, T> = new Map()

  /**
   * Adds a user to the manager
   * @param user - User to add
   */
  abstract addUser(user: T): Promise<void>

  /**
   * Gets a user by ID
   * @param id - User ID
   * @returns User or undefined
   */
  getUser(id: string): T | undefined {
    return this.users.get(id)
  }
}

// Generated .d.ts
/**
 * Base user management class
 */
export declare abstract class BaseUserManager<T extends User = User> {
  protected users: Map<string, T>
  /**
   * Adds a user to the manager
   * @param user - User to add
   */
  abstract addUser(user: T): Promise<void>
  /**
   * Gets a user by ID
   * @param id - User ID
   * @returns User or undefined
   */
  getUser(id: string): T | undefined
}
```

**Supported Class Features:**
- Abstract classes and methods
- Access modifiers (public, private, protected)
- Static members
- Generic type parameters
- Inheritance with `extends`
- Interface implementation with `implements`
- Constructor signatures
- Property declarations
- Method declarations

### Enums

Support for both numeric and string enums:

```typescript
// Source
/**
 * User role enumeration
 */
export enum UserRole {
  /** Standard user */
  USER = 'user',
  /** Administrator */
  ADMIN = 'admin',
  /** Super administrator */
  SUPER_ADMIN = 'super_admin'
}

export enum HttpStatus {
  OK = 200,
  NOT_FOUND = 404,
  SERVER_ERROR = 500
}

// Generated .d.ts
/**
 * User role enumeration
 */
export declare enum UserRole {
  /** Standard user */
  USER = 'user',
  /** Administrator */
  ADMIN = 'admin',
  /** Super administrator */
  SUPER_ADMIN = 'super_admin'
}
export declare enum HttpStatus {
  OK = 200,
  NOT_FOUND = 404,
  SERVER_ERROR = 500
}
```

### Variables and Constants

Smart type inference for variable declarations:

```typescript
// Source
export const API_BASE_URL = 'https://api.example.com' as const
export const DEFAULT_CONFIG = {
  timeout: 5000,
  retries: 3,
  debug: false
} as const

export let globalState: { user?: User } = {}

// Generated .d.ts
export declare const API_BASE_URL: "https://api.example.com"
export declare const DEFAULT_CONFIG: {
  readonly timeout: 5000
  readonly retries: 3
  readonly debug: false
}
export declare let globalState: { user?: User }
```

**Variable Features:**
- Const assertions for literal types
- Readonly type inference
- Complex object type inference
- Array type inference
- Function type inference

### Modules and Namespaces

Support for module declarations and namespaces:

```typescript
// Source
export namespace Utils {
  export interface Config {
    debug: boolean
  }

  export function log(message: string): void {
    // implementation
  }

  export namespace Validation {
    export function isEmail(value: string): boolean {
      // implementation
    }
  }
}

// Generated .d.ts
export declare namespace Utils {
  interface Config {
    debug: boolean
  }
  function log(message: string): void
  namespace Validation {
    function isEmail(value: string): boolean
  }
}
```

## Import and Export Handling

### ES6 Imports/Exports

```typescript
// Named exports
export { User, UserRole } from './types'
export type { ApiResponse } from './api'

// Default exports
export default class UserManager {}

// Re-exports
export * from './utils'
export * as Helpers from './helpers'
```

### Type-only Imports

```typescript
// Type-only imports are preserved
import type { User } from './types'
import { type Config, createUser } from './user'

// Generated appropriately in .d.ts
export declare function processUser(user: User, config: Config): void
```

## Advanced Type Features

### Conditional Types

```typescript
export type NonNullable<T> = T extends null | undefined ? never : T
export type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any
```

### Mapped Types

```typescript
export type Partial<T> = {
  [P in keyof T]?: T[P]
}

export type Pick<T, K extends keyof T> = {
  [P in K]: T[P]
}
```

### Template Literal Types

```typescript
export type EventName<T extends string> = `on${Capitalize<T>}`
export type CSSProperty = `--${string}`
```

## Type Inference

dtsx provides intelligent type inference for:

### Narrow Types for Constants

```typescript
// Source
const theme = 'dark' as const
const config = { api: 'v1', debug: true } as const

// Inferred as literal types
export declare const theme: "dark"
export declare const config: {
  readonly api: "v1"
  readonly debug: true
}
```

### Complex Object Types

```typescript
// Source
export const routes = {
  home: '/',
  about: '/about',
  user: (id: string) => `/user/${id}`
} as const

// Properly inferred function types
export declare const routes: {
  readonly home: "/"
  readonly about: "/about"
  readonly user: (id: string) => string
}
```

### Array and Tuple Types

```typescript
// Source
export const colors = ['red', 'green', 'blue'] as const
export const point: [number, number] = [0, 0]

// Generated with proper types
export declare const colors: readonly ["red", "green", "blue"]
export declare const point: [number, number]
```

## Narrow Type Inference

Unlike other tools that require `isolatedDeclarations` and explicit type annotations, dtsx infers the narrowest possible types directly from your source values:

```ts
// Source — no type annotations needed
export const port = 3000
export const name = 'Stacks'
export const items = [1, 2, 3]
export const config = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: 5000,
}
```

```ts
// Generated .d.ts — exact literal types
export declare const port: 3000
export declare const name: 'Stacks'
export declare const items: readonly [1, 2, 3]
export declare const config: {
  apiUrl: 'https://api.stacksjs.org';
  timeout: 5000
}
```

See the [Type Inference](./type-inference.md) page for the full comparison with oxc and tsc.

## isolatedDeclarations (Optional)

dtsx supports `isolatedDeclarations` as an **optional fast path**, not a requirement. When enabled, dtsx skips parsing initializer values for declarations that already have explicit, non-generic type annotations — a performance optimization without sacrificing correctness.

When disabled (the default), dtsx reads every initializer and infers the narrowest possible type. This is the recommended mode for most projects.

### Implementation Details

dtsx focuses on generating clean declaration files by:

- Extracting only exported declarations
- Removing implementation details
- Preserving type information and comments
- Optimizing import statements
- Inferring the narrowest types from values

### Best Practices

For optimal results with dtsx:

1. **Write normal TypeScript** — dtsx infers types from your values automatically
2. **Add comprehensive JSDoc comments** for documentation
3. **Use `as const`** when you want deeply readonly literal types
4. **Organize types logically** in your source files
5. **Use type-only imports** when importing only for types

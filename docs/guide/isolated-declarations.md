---
title: Isolated Declarations
description: Understanding TypeScript's isolated declarations and how dtsx leverages them.
---

# Isolated Declarations

dtsx leverages TypeScript's **isolated declarations** feature for extremely fast declaration file generation.

## What are Isolated Declarations?

Isolated declarations is a TypeScript compiler option that enables declaration files to be generated from a single source file without needing to analyze the entire project.

### Benefits

- **Speed** - No need to type-check the entire project
- **Parallelization** - Files can be processed independently
- **Simpler** - Each file is self-contained

### Requirements

When `isolatedDeclarations` is enabled, TypeScript requires explicit type annotations on all exported declarations. This enables tools like dtsx to generate `.d.ts` files without running the full TypeScript compiler.

## Enabling Isolated Declarations

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true
  }
}
```

## Code Requirements

### Explicit Return Types

Functions must have explicit return types:

```ts
// Good - explicit return type
export function greet(name: string): string {
  return `Hello, ${name}!`
}

// Bad - implicit return type (will error)
export function greet(name: string) {
  return `Hello, ${name}!`
}
```

### Explicit Variable Types

Exported variables need explicit types for complex values:

```ts
// Good - explicit type
export const config: Config = {
  port: 3000,
  host: 'localhost',
}

// Good - primitive types are inferred
export const version: string = '1.0.0'
export const count = 42 // number is inferred

// Bad - complex object without type (may error)
export const config = {
  port: 3000,
  host: 'localhost',
}
```

### Class Properties

Class properties need explicit types:

```ts
// Good
export class User {
  name: string
  age: number

  constructor(name: string, age: number) {
    this.name = name
    this.age = age
  }

  greet(): string {
    return `Hello, ${this.name}!`
  }
}

// Bad - missing return type
export class User {
  greet() {
    return `Hello!`
  }
}
```

## Common Patterns

### Type Exports

```ts
// types.ts
export interface User {
  id: number
  name: string
  email: string
}

export type UserRole = 'admin' | 'user' | 'guest'

export type CreateUserInput = Omit<User, 'id'>
```

### Function Exports

```ts
// utils.ts
export function formatDate(date: Date): string {
  return date.toISOString()
}

export function parseJSON<T>(json: string): T {
  return JSON.parse(json)
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url)
}
```

### Class Exports

```ts
// service.ts
export class ApiService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`)
    return response.json()
  }
}
```

### Constant Exports

```ts
// constants.ts
export const API_URL: string = 'https://api.example.com'
export const MAX_RETRIES: number = 3
export const DEFAULT_TIMEOUT: number = 5000

export const STATUS_CODES: Record<string, number> = {
  OK: 200,
  CREATED: 201,
  NOT_FOUND: 404,
}
```

## Migration Guide

### Step 1: Enable the Option

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true
  }
}
```

### Step 2: Fix Errors

Run TypeScript to find issues:

```bash
tsc --noEmit
```

### Step 3: Add Missing Annotations

Common fixes:

```ts
// Before
export function calculate(a, b) {
  return a + b
}

// After
export function calculate(a: number, b: number): number {
  return a + b
}
```

### Step 4: Use dtsx

Once all exports have explicit types:

```bash
bunx dtsx generate
```

## Error Messages

### "Exported function must have explicit return type"

```ts
// Error
export function foo() {
  return 'bar'
}

// Fix
export function foo(): string {
  return 'bar'
}
```

### "Exported variable must have explicit type"

```ts
// Error
export const data = getData()

// Fix
export const data: Data = getData()
```

### "Property must have explicit type"

```ts
// Error
export class Foo {
  bar = 'baz'
}

// Fix
export class Foo {
  bar: string = 'baz'
}
```

## Best Practices

### 1. Use Type Inference Where Safe

Primitive literals are safe to infer:

```ts
export const name = 'John' // string inferred
export const count = 42    // number inferred
export const active = true // boolean inferred
```

### 2. Be Explicit with Complex Types

```ts
// Use explicit types for objects
export const config: AppConfig = { ... }

// Use explicit types for arrays
export const items: string[] = ['a', 'b', 'c']

// Use explicit types for functions
export const handler: RequestHandler = (req, res) => { ... }
```

### 3. Export Types Separately

```ts
// Export interface for reuse
export interface Options {
  debug: boolean
  verbose: boolean
}

// Use exported interface
export function configure(options: Options): void {
  // ...
}
```

## Performance Comparison

With isolated declarations enabled, dtsx can process files much faster:

| Project Size | TypeScript | dtsx |
|--------------|------------|------|
| Small (10 files) | 2.5s | 0.1s |
| Medium (100 files) | 15s | 0.5s |
| Large (1000 files) | 120s | 4s |

## Related

- [Getting Started](./getting-started.md) - Installation and setup
- [Configuration](./configuration.md) - Configuration options
- [CLI Commands](./cli.md) - Command-line interface

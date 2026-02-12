---
title: Isolated Declarations
description: Understanding TypeScript's isolated declarations and how dtsx optionally leverages them.
---

# Isolated Declarations

dtsx works **without** `isolatedDeclarations` — it infers sound types directly from your source values, preserving original values via `@defaultValue` JSDoc. When `isolatedDeclarations` is enabled, dtsx uses it as an **optional fast path** to skip initializer parsing when explicit type annotations are present.

## dtsx Without isolatedDeclarations (Default)

By default, dtsx reads every initializer value and infers sound types, preserving original values via `@defaultValue` JSDoc:

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
// Generated .d.ts — sound types with @defaultValue
export declare const port: 3000
export declare const name: 'Stacks'
/** @defaultValue `[1, 2, 3]` */
export declare const items: number[]
/** @defaultValue `{ apiUrl: 'https://api.stacksjs.org', timeout: 5000 }` */
export declare const config: {
  /** @defaultValue 'https://api.stacksjs.org' */
  apiUrl: string;
  /** @defaultValue 5000 */
  timeout: number
}
```

Scalar `const` keeps literal types (truly immutable). Mutable container properties are widened with original values preserved — see the [full comparison](../features/type-inference.md).

## What are Isolated Declarations?

Isolated declarations is a TypeScript compiler option that enables declaration files to be generated from a single source file without needing to analyze the entire project.

### Benefits When Enabled

- **Performance fast path** — dtsx skips parsing initializers when explicit non-generic type annotations exist
- **Parallelization** — files can be processed independently
- **Compatibility** — matches the behavior expected by tsc and oxc

### Trade-offs

When `isolatedDeclarations` is enabled and a declaration has an explicit type annotation, dtsx trusts that annotation and skips value analysis. This means you may get broader types if your annotations are broad:

```ts
// With isolatedDeclarations ON + explicit annotation:
export const port: number = 3000
// → export declare const port: number    (uses annotation as-is)

// Without isolatedDeclarations (or no annotation):
export const port = 3000
// → export declare const port: 3000      (infers narrow literal)
```

**Important:** Even with `isolatedDeclarations` enabled, dtsx still infers narrow types when:
- There is no type annotation
- The annotation is a generic type (`any`, `object`, `unknown`, `Record<>`, `Array<>`, `{ [key]: V }`)

## Enabling Isolated Declarations

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true // optional — dtsx works great without it
  }
}
```

## Code Requirements (When Enabled)

When `isolatedDeclarations` is enabled in TypeScript, tsc requires explicit type annotations on exported declarations. dtsx is more lenient — it handles unannotated exports by inferring types from values.

### Explicit Return Types

Functions should have explicit return types:

```ts
// Recommended
export function greet(name: string): string {
  return `Hello, ${name}!`
}

// Also works with dtsx (but tsc would error with isolatedDeclarations)
export function greet(name: string) {
  return `Hello, ${name}!`
}
```

### Variable Types

dtsx infers types from values automatically — explicit annotations are optional:

```ts
// dtsx infers sound types from all of these:
export const port = 3000            // → 3000 (scalar const — immutable)
export const name = 'Stacks'        // → 'Stacks' (scalar const — immutable)
export const items = [1, 2, 3]      // → number[] + @defaultValue
export const config = {
  timeout: 5000,                    // → number + @defaultValue 5000
  debug: true,                      // → boolean + @defaultValue true
}

// Explicit annotations also work:
export const port: number = 3000    // → number (uses annotation)
```

## Common Patterns

### Const Assertions

`as const` gives you deeply readonly literal types:

```ts
export const STATUSES = ['pending', 'active', 'completed'] as const
// → readonly ['pending', 'active', 'completed']

export type Status = typeof STATUSES[number]
// Resolves to: 'pending' | 'active' | 'completed'
```

### Type Exports

```ts
export interface User {
  id: number
  name: string
  email: string
}

export type UserRole = 'admin' | 'user' | 'guest'
```

### Function Exports

```ts
export function formatDate(date: Date): string {
  return date.toISOString()
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url)
}
```

## Related

- [Type Inference](../features/type-inference.md) - Full comparison with oxc and tsc
- [Getting Started](./getting-started.md) - Installation and setup
- [Configuration](./configuration.md) - Configuration options

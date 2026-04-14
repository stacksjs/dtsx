---
title: Isolated Declarations
description: Understanding TypeScript's isolated declarations and how dtsx optionally leverages them.
---

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

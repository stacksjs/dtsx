# Type Inference

dtsx generates **sound, narrow types** with `@defaultValue` preservation — no `isolatedDeclarations` flag required, no explicit type annotations needed. Where tsc and oxc silently discard original values when widening types, dtsx preserves them as standard `@defaultValue` JSDoc so they surface in IDE hover tooltips.

## How It Works

In TypeScript, `const` only makes the _binding_ immutable — object properties and array elements remain mutable. This means `const config = { timeout: 5000 }` allows `config.timeout = 9999`, so the declared type must be `number`, not `5000`.

dtsx generates **sound** types (correctly widened for mutable containers) while preserving original values via `@defaultValue` JSDoc:

- **Scalar `const`** → literal types (`3000`, `'hello'`, `true`) — truly immutable
- **`const` objects** → widened property types + `@defaultValue` per property
- **`const` arrays** → `T[]` + `@defaultValue` with original elements
- **`as const`** → deeply readonly literal types at every level (no `@defaultValue` needed)
- **`let`/`var`** → widened types + `@defaultValue`
- **Generic annotations** → replaced with narrow types inferred from the value
- **Promise types** → narrow resolved types (immutable)

## Scalar Constants

Scalar `const` bindings are truly immutable — the value can never change:

```ts
// Source
export const port = 3000
export const name = 'Stacks'
export const debug = true
export const bigInt = 123n
export const greeting = `Hello World`
```

```ts
// Generated .d.ts — exact literal types
export declare const port: 3000
export declare const name: 'Stacks'
export declare const debug: true
export declare const bigInt: 123n
export declare const greeting: `Hello World`
```

## Mutable Bindings

`let` and `var` bindings are mutable, so types are widened. The original value is preserved via `@defaultValue`:

```ts
// Source
export let test = 'test'
export var hello = 'Hello World'
```

```ts
// Generated .d.ts — widened types with @defaultValue
/** @defaultValue 'test' */
export declare let test: string
/** @defaultValue 'Hello World' */
export declare var hello: string
```

## Object Types with `@defaultValue`

Object properties are mutable (even on a `const` binding), so dtsx widens property types and adds `@defaultValue` annotations to preserve the original values:

```ts
// Source
export const config = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: 5000,
  retries: 3,
  features: {
    darkMode: true,
    notifications: false,
  },
  routes: ['/', '/about', '/contact'],
}
```

```ts
// Generated .d.ts — sound types with @defaultValue
/**
 * @defaultValue
 * ```ts
 * {
 *   apiUrl: 'https://api.stacksjs.org',
 *   timeout: 5000,
 *   retries: 3,
 *   features: { darkMode: true, notifications: false },
 *   routes: ['/', '/about', '/contact']
 * }
 * ```
 */
export declare const config: {
  /** @defaultValue 'https://api.stacksjs.org' */
  apiUrl: string;
  /** @defaultValue 5000 */
  timeout: number;
  /** @defaultValue 3 */
  retries: number;
  features: {
    /** @defaultValue true */
    darkMode: boolean;
    /** @defaultValue false */
    notifications: boolean
  };
  routes: string[]
}
```

Every property gets its widened type with the original value in `@defaultValue`. Hovering any property in your IDE shows the default.

## Array Types with `@defaultValue`

Arrays in mutable containers are widened to `T[]`. The original elements are preserved via `@defaultValue`:

```ts
// Source
export const items = [1, 2, 3]
```

```ts
// Generated .d.ts
/** @defaultValue `[1, 2, 3]` */
export declare const items: number[]
```

## Deep `as const`

`as const` declarations are explicitly immutable — types stay narrow with no widening and no `@defaultValue` (the types are already self-documenting):

```ts
// Source
export const CONFIG = {
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 5000,
    retries: 3,
  },
  features: {
    darkMode: true,
    notifications: false,
  },
  routes: ['/', '/about', '/contact'],
} as const
```

```ts
// Generated .d.ts — exact literal types, no @defaultValue needed
export declare const CONFIG: {
  api: {
    baseUrl: 'https://api.example.com';
    timeout: 5000;
    retries: 3
  };
  features: {
    darkMode: true;
    notifications: false
  };
  routes: readonly ['/', '/about', '/contact']
}
```

This enables the common pattern of deriving union types from const arrays:

```ts
export const STATUSES = ['pending', 'active', 'completed'] as const
export type Status = typeof STATUSES[number]
// Resolves to: 'pending' | 'active' | 'completed'
```

## Generic Type Replacement

When a `const` has a broad generic annotation but a specific value, dtsx replaces the generic with the narrow inferred type:

```ts
// Source — generic index signature
export const conf: { [key: string]: string } = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: '5000',
}
```

```ts
// Generated .d.ts — exact shape, not broad index signature
export declare const conf: {
  apiUrl: 'https://api.stacksjs.org';
  timeout: '5000'
}
```

This applies to these generic types: `any`, `object`, `unknown`, `Record<K, V>`, `T[]`, and `{ [key: K]: V }` index signatures.

## Promise Types

Promise resolved values are immutable, so dtsx preserves the narrow type:

```ts
// Source
export const promiseVal = Promise.resolve(42)
```

```ts
// Generated .d.ts
export declare const promiseVal: Promise<42>
```

## Comparison with Other Tools

All output below is from running the same source file through each tool. Nothing hand-edited.

### Why dtsx Preserves Values

All three tools correctly widen mutable container properties. The difference is what happens to the original values:

| Tool | Widened type | Original value preserved? |
|---|---|---|
| **dtsx** | `/** @defaultValue 5000 */ timeout: number` | **Yes** — via `@defaultValue` JSDoc |
| tsc | `timeout: number` | No — value lost entirely |
| oxc | `timeout: number` | No — value lost entirely |

### Scalar Constants

```ts
export const port = 3000
export const debug = true
```

| | `port` | `debug` |
|---|---|---|
| **dtsx** | `3000` | `true` |
| tsc | `3000` | `true` |
| oxc | `3e3` _(mangled!)_ | `boolean` |

### Object Properties

```ts
export const config = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: 5000,
  features: { darkMode: true, notifications: false },
  routes: ['/', '/about', '/contact'],
}
```

| Property | dtsx | tsc | oxc |
|---|---|---|---|
| `apiUrl` | `string` + `@defaultValue` | `string` | `string` |
| `timeout` | `number` + `@defaultValue` | `number` | `number` |
| `darkMode` | `boolean` + `@defaultValue` | `boolean` | `boolean` |
| `routes` | `string[]` | `string[]` | `unknown` _(error)_ |

### Generic Annotations

```ts
export const conf: { [key: string]: string } = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: '5000',
}
```

| Tool | Output |
|---|---|
| **dtsx** | `{ apiUrl: 'https://api.stacksjs.org'; timeout: '5000' }` |
| tsc | `{ [key: string]: string }` — kept broad |
| oxc | `{ [key: string]: string }` — kept broad |

### Promise Types

```ts
export const promiseVal = Promise.resolve(42)
```

| Tool | Output |
|---|---|
| **dtsx** | `Promise<42>` _(resolved values are immutable)_ |
| tsc | `Promise<number>` |
| oxc | `unknown` _(error — requires explicit annotation)_ |

### Full Summary

| Declaration | dtsx | tsc | oxc |
|---|---|---|---|
| `const port = 3000` | `3000` | `3000` | `3e3` |
| `const debug = true` | `true` | `true` | `boolean` |
| `const items = [1,2,3]` | `number[]` + `@defaultValue` | `number[]` | `unknown` (error) |
| `config.apiUrl` | `string` + `@defaultValue` | `string` | `string` |
| `config.timeout` | `number` + `@defaultValue` | `number` | `number` |
| `config.routes` | `string[]` | `string[]` | `unknown` (error) |
| `conf` _(generic annotation)_ | exact properties | `{ [key]: string }` | `{ [key]: string }` |
| `Promise.resolve(42)` | `Promise<42>` | `Promise<number>` | `unknown` (error) |
| **Value info preserved?** | **Yes** | **No** | **No** |
| **Errors** | **0** | **0** | **3** |

- **tsc** compiles fine but widens object properties to `string`/`number`/`boolean` and arrays to `type[]`. Original values are lost.
- **oxc** uses `isolatedDeclarations` mode which requires explicit type annotations or `as const` — without them it errors and emits `unknown`.
- **tsc --isolatedDeclarations** produces the same 3 errors as oxc and refuses to emit output.
- **dtsx** produces sound, widened types and preserves every original value via `@defaultValue` JSDoc. Zero errors, zero annotations needed.

## isolatedDeclarations (Optional)

dtsx supports `isolatedDeclarations` as an **optional fast path**, not a requirement. When enabled, dtsx skips parsing initializer values for declarations that already have explicit, non-generic type annotations — saving time without sacrificing correctness.

When disabled (the default), dtsx reads every initializer and infers the correct type. This is the recommended mode for most projects.

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true // optional — dtsx works great without it
  }
}
```

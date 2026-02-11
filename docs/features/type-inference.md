# Type Inference

dtsx generates the **narrowest possible types** from your source values — no `isolatedDeclarations` flag required, no explicit type annotations needed. Where other tools emit broad types like `string`, `number`, or `number[]`, dtsx preserves the exact literal types from your code.

## How It Works

dtsx reads every initializer value and infers the precise type:

- **`const` declarations** → literal types (`42`, `'hello'`, `true`)
- **Objects** → exact property shapes with literal value types
- **Arrays** → readonly tuples with per-element types
- **`as const`** → deeply readonly literal types at every level
- **Generic annotations** → replaced with narrow types inferred from the value
- **`let`/`var`** → narrow inference (`'hello'` not `string`)

## Literal Types

```ts
// Source
export const port = 3000
export const name = 'Stacks'
export const debug = true
export const bigInt = 123n
export const greeting = `Hello World`
export let test = 'test'
export var hello = 'Hello World'
```

```ts
// Generated .d.ts
export declare const port: 3000
export declare const name: 'Stacks'
export declare const debug: true
export declare const bigInt: 123n
export declare const greeting: `Hello World`
export declare let test: 'test'
export declare var hello: 'Hello World'
```

Every value is preserved as its exact literal type.

## Object Types

dtsx infers exact property types from object values — no `as const` needed:

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
// Generated .d.ts
export declare const config: {
  apiUrl: 'https://api.stacksjs.org';
  timeout: 5000;
  retries: 3;
  features: {
    darkMode: true;
    notifications: false
  };
  routes: readonly ['/', '/about', '/contact']
}
```

Every property gets its literal type. Arrays become readonly tuples.

## Array → Readonly Tuple

Arrays are automatically converted to readonly tuples with exact element types:

```ts
// Source
export const items = [1, 2, 3]
export const mixed = ['hello', 42, true]
export const nested = [[1, 2], [3, 4]]
```

```ts
// Generated .d.ts
export declare const items: readonly [1, 2, 3]
export declare const mixed: readonly ['hello', 42, true]
export declare const nested: readonly [readonly [1, 2], readonly [3, 4]]
```

## Deep `as const`

`as const` declarations get deeply readonly literal types at every nesting level:

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
// Generated .d.ts
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

This applies to these generic types: `any`, `object`, `unknown`, `Record<K, V>`, `Array<T>`, and `{ [key: K]: V }` index signatures.

## Promise Types

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

### Literal Values

```ts
export const port = 3000
export const debug = true
export const items = [1, 2, 3]
```

| | `port` | `debug` | `items` |
|---|---|---|---|
| **dtsx** | **`3000`** | **`true`** | **`readonly [1, 2, 3]`** |
| oxc | `3e3` _(mangled!)_ | `boolean` | `unknown` _(error)_ |
| tsc | `3000` | `true` | `number[]` |

> oxc and tsc only narrow arrays with explicit `as const`. dtsx always narrows.

### Object Properties

```ts
export const config = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: 5000,
  features: { darkMode: true, notifications: false },
  routes: ['/', '/about', '/contact'],
}
```

| Property | dtsx | oxc | tsc |
|---|---|---|---|
| `apiUrl` | **`'https://api.stacksjs.org'`** | `string` | `string` |
| `timeout` | **`5000`** | `number` | `number` |
| `darkMode` | **`true`** | `boolean` | `boolean` |
| `routes` | **`readonly ['/', '/about', '/contact']`** | `unknown` _(error)_ | `string[]` |

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
| oxc | `{ [key: string]: string }` — kept broad |
| tsc | `{ [key: string]: string }` — kept broad |

### Promise Types

```ts
export const promiseVal = Promise.resolve(42)
```

| Tool | Output |
|---|---|
| **dtsx** | `Promise<42>` |
| oxc | `unknown` _(error — requires explicit annotation)_ |
| tsc | `Promise<number>` |

### Full Summary

| Declaration | dtsx | oxc | tsc |
|---|---|---|---|
| `const port = 3000` | `3000` | `3e3` | `3000` |
| `const debug = true` | `true` | `boolean` | `true` |
| `const items = [1,2,3]` | `readonly [1,2,3]` | `unknown` (error) | `number[]` |
| `config.apiUrl` | `'https://...'` | `string` | `string` |
| `config.timeout` | `5000` | `number` | `number` |
| `config.routes` | readonly tuple | `unknown` (error) | `string[]` |
| `conf` _(generic annotation)_ | exact properties | `{ [key]: string }` | `{ [key]: string }` |
| `Promise.resolve(42)` | `Promise<42>` | `unknown` (error) | `Promise<number>` |
| **Errors** | **0** | **3** | **0** |

- **oxc** uses `isolatedDeclarations` mode which requires explicit type annotations or `as const` — without them it errors and emits `unknown`.
- **tsc** compiles fine but broadens object properties to `string`/`number`/`boolean` and arrays to `type[]`.
- **tsc --isolatedDeclarations** produces the same 3 errors as oxc and refuses to emit output.
- **dtsx** infers the narrowest type from every value automatically. Zero errors, zero annotations needed.

## isolatedDeclarations (Optional)

dtsx supports `isolatedDeclarations` as an **optional fast path**, not a requirement. When enabled, dtsx skips parsing initializer values for declarations that already have explicit, non-generic type annotations — saving time without sacrificing correctness.

When disabled (the default), dtsx reads every initializer and infers the narrowest possible type. This is the recommended mode for most projects.

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true // optional — dtsx works great without it
  }
}
```

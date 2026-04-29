---
title: Isolated Declarations
description: Understanding TypeScript's isolated declarations and how dtsx optionally leverages them.
---

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

# Type Support

dtsx provides comprehensive support for various TypeScript type constructs. This page details the supported types and how they are handled.

## Basic Types

- **Primitive Types**: `string`, `number`, `boolean`, `null`, `undefined`
- **Literal Types**: String, number, and boolean literals
- **Union Types**: Combinations of multiple types
- **Intersection Types**: Merged types with all properties

## Complex Types

### Interfaces and Types

```typescript
interface User {
  name: string;
  age: number;
  email?: string;
}

type UserRole = 'admin' | 'user' | 'guest';
```

### Functions and Methods

```typescript
function process<T>(input: T): Promise<T>;
interface Processor {
  transform<T>(data: T): T;
}
```

### Classes and Enums

```typescript
class User {
  constructor(name: string);
  getName(): string;
}

enum UserStatus {
  Active,
  Inactive,
  Pending
}
```

### Generics

```typescript
interface Container<T> {
  value: T;
  getValue(): T;
}
```

## Advanced Type Features

### Conditional Types

```typescript
type IsString<T> = T extends string ? true : false;
```

### Mapped Types

```typescript
type Readonly<T> = {
  readonly [P in keyof T]: T[P];
};
```

### Utility Types

- `Partial<T>`
- `Required<T>`
- `Readonly<T>`
- `Record<K,T>`
- `Pick<T,K>`
- `Omit<T,K>`
- `Exclude<T,U>`
- `Extract<T,U>`
- `NonNullable<T>`
- `ReturnType<T>`
- `InstanceType<T>`

## Type Inference

dtsx provides intelligent type inference for:

- Object literals
- Array literals
- Function return types
- Generic type parameters
- Union types
- Intersection types

## Type Augmentation

Support for:

- Module augmentation
- Interface merging
- Declaration merging
- Ambient declarations

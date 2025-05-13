# Type Inference

dtsx provides powerful type inference capabilities to automatically determine types from your code.

## Basic Type Inference

### Literal Types

```typescript
// String literal
const name = "John";  // type: "John"

// Number literal
const age = 25;       // type: 25

// Boolean literal
const isActive = true; // type: true
```

### Array Types

```typescript
// Array of numbers
const numbers = [1, 2, 3];  // type: number[]

// Tuple type
const tuple = [1, "hello"]; // type: [number, string]
```

### Object Types

```typescript
const user = {
  name: "John",
  age: 25,
  active: true
}; // type: { name: string; age: number; active: boolean; }
```

## Advanced Type Inference

### Function Return Types

```typescript
function process<T>(input: T) {
  return input;
} // Return type: T

async function fetchData() {
  return await api.get('/data');
} // Return type: Promise<ApiResponse>
```

### Generic Type Inference

```typescript
function map<T, U>(arr: T[], fn: (item: T) => U): U[] {
  return arr.map(fn);
}

// Usage
const numbers = [1, 2, 3];
const strings = map(numbers, n => n.toString());
// strings type: string[]
```

### Union Type Inference

```typescript
function processValue(value: string | number) {
  if (typeof value === 'string') {
    return value.toUpperCase(); // type: string
  }
  return value.toFixed(2); // type: string
}
```

## Type Inference Features

### Contextual Typing

- Function parameters
- Object literals
- Array literals
- Class members
- Interface implementations

### Type Narrowing

- Type guards
- Control flow analysis
- Discriminated unions
- Property checks

### Type Widening

- Literal to primitive
- Union type expansion
- Const assertions
- Type assertions

## Best Practices

1. **Use Type Annotations When Needed**

   ```typescript
   // When inference might be too specific
   const config: Config = {
     // ...
   };
   ```

2. **Leverage Const Assertions**

   ```typescript
   const colors = ['red', 'green', 'blue'] as const;
   // type: readonly ["red", "green", "blue"]
   ```

3. **Use Type Guards**

   ```typescript
   function isUser(value: unknown): value is User {
     return typeof value === 'object' && value !== null && 'name' in value;
   }
   ```

4. **Avoid Type Assertions**

   ```typescript
   // Prefer this
   const value = process(input);

   // Over this
   const value = process(input) as string;
   ```

## Configuration

```typescript
interface TypeInferenceConfig {
  // Enable/disable type inference
  enableInference: boolean;

  // Inference strictness level
  strictness: 'loose' | 'strict' | 'very-strict';

  // Custom inference rules
  customRules: InferenceRule[];
}
```

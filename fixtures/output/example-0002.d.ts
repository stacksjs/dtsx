/**
 * Extended test cases for DTS generation
 */

// Complex Generic Types
export declare interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T;
  key: K;
  value: T[K];
  transform: (input: T[K]) => string;
  nested: Array<Partial<T>>;
}

// Intersection and Union Types
export declare type ComplexUnionIntersection = (User & {
  role: 'admin';
}) | (Product & {
  category: string;
}) & {
  metadata: Record<string, unknown>;
};

// Mapped and Conditional Types
export declare type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P];
};

export declare type ConditionalResponse<T> = T extends Array<infer U>
  ? ApiResponse<U[]>
  : T extends object
    ? ApiResponse<T>
    : ApiResponse<string>;

// Complex Function Overloads
export declare function processData(data: string): string;
export declare function processData(data: number): number;
export declare function processData(data: boolean): boolean;
export declare function processData<T extends object>(data: T): T;

// Nested Object Types with Methods
export declare const complexObject: {
  handlers: {
    onSuccess<T>(data: T): Promise<void>;
    onError(error: Error & { code?: number }): never;
  };
  utils: {
    formatters: {
      date: (input: Date) => string;
      currency: (amount: number, currency?: string) => string;
    };
  };
};

// Template Literal Types
export declare type EventType = 'click' | 'focus' | 'blur';
export declare type ElementType = 'button' | 'input' | 'form';
export declare type EventHandler = `on${Capitalize<EventType>}${Capitalize<ElementType>}`;

// Recursive Types
export declare type RecursiveObject = {
  id: string;
  children?: RecursiveObject[];
  parent?: RecursiveObject;
  metadata: Record<string, unknown>;
};

// Complex Array Types
export declare const complexArrays: {
  matrix: [
    [number, number, [number, number, [number, number]]],
    [string, string, [string, string]],
    [boolean, [boolean, [boolean]]]
  ];
  tuples: readonly [
    readonly [1, 'string', true],
    readonly ['literal', 42, false]
  ];
  mixedArrays: [
    Date,
    Promise<string>,
    () => Promise<string>,
    Generator
  ];
};

// Default Type Parameters
export declare interface DefaultGeneric<
  T = string,
  K extends keyof any = string,
  V extends Record<K, T> = Record<K, T>
> {
  key: K;
  value: T;
  record: V;
}

// Method Decorators and Metadata
export declare const methodDecorator: (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => PropertyDescriptor;

// Complex Async Patterns
export declare function complexAsyncGenerator(): AsyncGenerator<
  User | Product | AuthResponse,
  void,
  unknown
>;

// Type Assertions and Guards
export declare function isUser(value: unknown): value is User;

// Branded Types
export declare type UserId = string & {
  readonly __brand: unique symbol;
};
export declare type ProductId = number & {
  readonly __brand: unique symbol;
};

// Complex Error Handling
export declare class CustomError extends Error {
  readonly code: number;
  readonly metadata: Record<string, unknown>;
  constructor(message: string, code: number, metadata: Record<string, unknown>);
}

// Module Augmentation
declare module '@stacksjs/dtsx' {
  interface DtsGenerationConfig {
    customPlugins?: Array<{
      name: string;
      transform: (code: string) => string;
    }>;
  }
}

// Utility Type Implementations
export declare type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

export declare type DeepRequired<T> = T extends object
  ? { [P in keyof T]-?: DeepRequired<T[P]> }
  : T;

// Complex Constants with Type Inference
export declare const CONFIG_MAP: {
  readonly development: {
    readonly features: {
      readonly auth: {
        readonly providers: readonly ['google', 'github'];
        readonly settings: {
          readonly timeout: 5000;
          readonly retries: 3;
        };
      };
    };
  };
  readonly production: {
    readonly features: {
      readonly auth: {
        readonly providers: readonly ['google', 'github', 'microsoft'];
        readonly settings: {
          readonly timeout: 3000;
          readonly retries: 5;
        };
      };
    };
  };
};

// Polymorphic Types
export declare type PolymorphicComponent<P = {}> = {
  <C extends React.ElementType>(
    props: { as?: C } & Omit<React.ComponentPropsWithRef<C>, keyof P> & P
  ): React.ReactElement | null;
};

// Type Inference in Functions
export declare function createApi<T extends Record<string, (...args: any[]) => any>>(
  endpoints: T
): { [K in keyof T]: ReturnType<T[K]> extends Promise<infer R> ? R : ReturnType<T[K]> };

// Complex Index Types
export declare type DynamicRecord<K extends PropertyKey> = {
  [P in K]: P extends number
    ? Array<unknown>
    : P extends string
      ? Record<string, unknown>
      : never;
};

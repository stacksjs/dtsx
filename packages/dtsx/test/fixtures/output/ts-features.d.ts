/** Function using import.meta.url */
export declare function getModuleUrl(): string;
/** Function using import.meta.resolve */
export declare function resolveModule(specifier: string): Promise<string>;
/** Function returning computed property object */
export declare function createWithComputed<K extends string>(key: K, value: string): { [P in K]: string };
/** Create a disposable resource */
export declare function createResource(): Disposable;
/** Create an async disposable resource */
export declare function createAsyncResource(): AsyncDisposable;
/** Example function using 'using' declaration */
export declare function processWithResource(): void;
/** Example async function using 'await using' */
export declare function processWithAsyncResource(): Promise<void>;
/** Simple as const */
export declare const SIMPLE_CONST: 'hello';
/** Nested object with as const */
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
};
/** Array as const */
export declare const STATUSES: readonly ['pending', 'active', 'completed', 'archived'];
/** Deeply nested as const */
export declare const DEEP_CONFIG: {
  level1: {
  level2: {
  level3: {
  value: 42;
  items: readonly [1, 2, 3]
}
}
}
};
/**
 * Object with computed properties
 * @defaultValue `{ [COMPUTED_KEY]: 'value', [`prefix_${COMPUTED_KEY}`]: 'prefixed' }`
 */
export declare const computedObject: {
  /** @defaultValue 'value' */
  [COMPUTED_KEY]: string;
  /** @defaultValue 'prefixed' */
  [`prefix_${COMPUTED_KEY}`]: string
};
/** Custom symbol */
export declare const customSymbol: symbol;
/** Object with symbol keys */
export declare const symbolObject: {
  [Symbol.toStringTag]: 'MyObject'
};
/** Type for import.meta properties */
export declare interface ImportMeta {
  url: string
  main: boolean
  env: Record<string, string>
  resolve(specifier: string): string
}
/** Interface with computed property */
export declare interface ComputedProps {
  [COMPUTED_KEY]: string
  normalProp: number
}
/** Well-known symbol usage */
export declare interface SymbolKeyed {
  [Symbol.iterator](): Iterator<number>
  [Symbol.toStringTag]: string
  [Symbol.asyncIterator]?(): AsyncIterator<number>
}
/** Disposable interface for using declarations */
export declare interface Disposable {
  [Symbol.dispose](): void
}
/** Async disposable interface */
export declare interface AsyncDisposable {
  [Symbol.asyncDispose](): Promise<void>
}
/** Type derived from as const */
export type Status = typeof STATUSES[number];
/** Class with symbol properties */
export declare class SymbolClass {
  [Symbol.toStringTag]: string;
  *[Symbol.iterator](): Generator<number>;
  get [customSymbol](): string;
}
/** Class with private fields */
export declare class PrivateFieldsClass {
  name: string;
  constructor(name: string, data: number);
  get data(): number;
  processData(): number;
  static get count(): number;
}
/** Class extending private fields class */
export declare class ExtendedPrivateClass extends PrivateFieldsClass {
  constructor(name: string, data: number, flag: boolean);
  get flag(): boolean;
}
/** Class with static initialization block */
export declare class StaticBlockClass {
  static readonly config: { initialized: boolean, timestamp: number };
  static instances: Map<string, StaticBlockClass>;
  id: string;
  constructor();
}
/** Class with multiple static blocks and complex initialization */
export declare class ComplexStaticBlocks {
  static readonly PRIMARY_CONFIG: Record<string, unknown>;
  static readonly SECONDARY_CONFIG: Record<string, unknown>;
  constructor();
}
/** Class implementing Disposable */
export declare class DisposableConnection implements Disposable {
  connect(): void;
  [Symbol.dispose](): void;
}
/** DisposableStack for managing multiple resources */
export declare class ResourceManager {
  add(resource: Disposable): void;
  [Symbol.dispose](): void;
}

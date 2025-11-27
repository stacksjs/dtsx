/**
 * Test fixture for advanced TypeScript features
 * Tests: import.meta, as const, computed properties, Symbol keys,
 * private fields, static blocks, using declarations
 */

// ============================================
// 1. import.meta type declarations
// ============================================

/** Type for import.meta properties */
export interface ImportMeta {
  url: string
  main: boolean
  env: Record<string, string>
  resolve(specifier: string): string
}

/** Function using import.meta.url */
export function getModuleUrl(): string {
  return import.meta.url
}

/** Function using import.meta.resolve */
export async function resolveModule(specifier: string): Promise<string> {
  return import.meta.resolve(specifier)
}

// ============================================
// 2. as const nested objects (deep readonly)
// ============================================

/** Simple as const */
export const SIMPLE_CONST = 'hello' as const

/** Nested object with as const */
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

/** Array as const */
export const STATUSES = ['pending', 'active', 'completed', 'archived'] as const

/** Type derived from as const */
export type Status = typeof STATUSES[number]

/** Deeply nested as const */
export const DEEP_CONFIG = {
  level1: {
    level2: {
      level3: {
        value: 42,
        items: [1, 2, 3],
      },
    },
  },
} as const

// ============================================
// 3. Computed property names
// ============================================

/** Computed property key */
const COMPUTED_KEY = 'dynamicProperty'

/** Interface with computed property */
export interface ComputedProps {
  [COMPUTED_KEY]: string
  normalProp: number
}

/** Object with computed properties */
export const computedObject = {
  [COMPUTED_KEY]: 'value',
  [`prefix_${COMPUTED_KEY}`]: 'prefixed',
}

/** Function returning computed property object */
export function createWithComputed<K extends string>(key: K, value: string): { [P in K]: string } {
  return { [key]: value } as { [P in K]: string }
}

// ============================================
// 4. Symbol property keys
// ============================================

/** Custom symbol */
export const customSymbol = Symbol('custom')

/** Well-known symbol usage */
export interface SymbolKeyed {
  [Symbol.iterator](): Iterator<number>
  [Symbol.toStringTag]: string
  [Symbol.asyncIterator]?(): AsyncIterator<number>
}

/** Class with symbol properties */
export class SymbolClass {
  [Symbol.toStringTag] = 'SymbolClass';

  *[Symbol.iterator](): Generator<number> {
    yield 1
    yield 2
    yield 3
  }

  get [customSymbol](): string {
    return 'custom value'
  }
}

/** Object with symbol keys */
export const symbolObject: { [Symbol.toStringTag]: string } = {
  [Symbol.toStringTag]: 'MyObject',
}

// ============================================
// 5. Private class fields (#field)
// ============================================

/** Class with private fields */
export class PrivateFieldsClass {
  /** Public property */
  public name: string

  /** Private field using # syntax */
  #privateData: number

  /** Private readonly field */
  readonly #privateId: string

  /** Private static field */
  static #instanceCount = 0

  constructor(name: string, data: number) {
    this.name = name
    this.#privateData = data
    this.#privateId = crypto.randomUUID()
    PrivateFieldsClass.#instanceCount++
  }

  /** Accessor for private data */
  get data(): number {
    return this.#privateData
  }

  /** Private method using # syntax */
  #privateMethod(): void {
    console.log(this.#privateData)
  }

  /** Public method accessing private */
  processData(): number {
    this.#privateMethod()
    return this.#privateData * 2
  }

  /** Static accessor for instance count */
  static get count(): number {
    return PrivateFieldsClass.#instanceCount
  }
}

/** Class extending private fields class */
export class ExtendedPrivateClass extends PrivateFieldsClass {
  #additionalPrivate: boolean

  constructor(name: string, data: number, flag: boolean) {
    super(name, data)
    this.#additionalPrivate = flag
  }

  get flag(): boolean {
    return this.#additionalPrivate
  }
}

// ============================================
// 6. Static blocks in classes
// ============================================

/** Class with static initialization block */
export class StaticBlockClass {
  static readonly config: { initialized: boolean, timestamp: number }
  static instances: Map<string, StaticBlockClass>
  static #privateStatic: string

  /** Static initialization block */
  static {
    this.config = {
      initialized: true,
      timestamp: Date.now(),
    }
    this.instances = new Map()
    this.#privateStatic = 'initialized'
  }

  id: string

  constructor() {
    this.id = crypto.randomUUID()
    StaticBlockClass.instances.set(this.id, this)
  }

  /** Another static block for additional initialization */
  static {
    console.log('StaticBlockClass loaded')
  }
}

/** Class with multiple static blocks and complex initialization */
export class ComplexStaticBlocks {
  static readonly PRIMARY_CONFIG: Record<string, unknown>
  static readonly SECONDARY_CONFIG: Record<string, unknown>
  static #internalState: WeakMap<object, unknown>

  static {
    // First block: primary configuration
    this.PRIMARY_CONFIG = {
      version: '1.0.0',
      mode: 'production',
    }
  }

  static {
    // Second block: secondary configuration based on primary
    this.SECONDARY_CONFIG = {
      ...this.PRIMARY_CONFIG,
      extended: true,
    }
    this.#internalState = new WeakMap()
  }

  constructor() {
    ComplexStaticBlocks.#internalState.set(this, { created: Date.now() })
  }
}

// ============================================
// 7. using declarations (TS 5.2+)
// ============================================

/** Disposable interface for using declarations */
export interface Disposable {
  [Symbol.dispose](): void
}

/** Async disposable interface */
export interface AsyncDisposable {
  [Symbol.asyncDispose](): Promise<void>
}

/** Create a disposable resource */
export function createResource(): Disposable {
  const resource = {
    data: new Uint8Array(1024),
    [Symbol.dispose]() {
      console.log('Resource disposed')
    },
  }
  return resource
}

/** Create an async disposable resource */
export function createAsyncResource(): AsyncDisposable {
  return {
    [Symbol.asyncDispose]: async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      console.log('Async resource disposed')
    },
  }
}

/** Class implementing Disposable */
export class DisposableConnection implements Disposable {
  #isOpen = true

  connect(): void {
    this.#isOpen = true
  }

  [Symbol.dispose](): void {
    if (this.#isOpen) {
      this.#isOpen = false
      console.log('Connection closed')
    }
  }
}

/** Example function using 'using' declaration */
export function processWithResource(): void {
  using resource = createResource()
  // Resource automatically disposed when function exits
  console.log('Processing with resource')
}

/** Example async function using 'await using' */
export async function processWithAsyncResource(): Promise<void> {
  await using resource = createAsyncResource()
  // Async resource automatically disposed when function exits
  console.log('Processing with async resource')
}

/** DisposableStack for managing multiple resources */
export class ResourceManager {
  #stack: Disposable[] = []

  add(resource: Disposable): void {
    this.#stack.push(resource)
  }

  [Symbol.dispose](): void {
    // Dispose in reverse order
    while (this.#stack.length > 0) {
      const resource = this.#stack.pop()
      resource?.[Symbol.dispose]()
    }
  }
}

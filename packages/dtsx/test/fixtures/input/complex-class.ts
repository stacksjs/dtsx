// Complex class features

/**
 * Base event emitter class
 */
export abstract class EventEmitter<Events extends Record<string, any[]>> {
  private listeners: Map<string, Set<Function>> = new Map()

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    const set = this.listeners.get(event as string) ?? new Set()
    set.add(listener)
    this.listeners.set(event as string, set)
    return this
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    this.listeners.get(event as string)?.delete(listener)
    return this
  }

  protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    this.listeners.get(event as string)?.forEach(fn => fn(...args))
  }

  abstract dispose(): void
}

/**
 * Logger interface for dependency injection
 */
interface Logger {
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, error?: Error): void
}

/**
 * Application events definition
 */
interface AppEvents {
  start: []
  stop: []
  error: [error: Error]
  data: [key: string, value: unknown]
}

/**
 * Main application class extending EventEmitter
 */
export class Application extends EventEmitter<AppEvents> {
  readonly version: string = '1.0.0'
  private logger: Logger
  protected running: boolean = false

  constructor(logger: Logger) {
    super()
    this.logger = logger
  }

  async start(): Promise<void> {
    this.logger.info('Starting application')
    this.running = true
    this.emit('start')
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping application')
    this.running = false
    this.emit('stop')
  }

  dispose(): void {
    this.stop()
  }

  get isRunning(): boolean {
    return this.running
  }
}

/**
 * Generic container with static factory methods
 */
export class Container<T> {
  private items: T[] = []

  private constructor(items?: T[]) {
    this.items = items ?? []
  }

  static empty<T>(): Container<T> {
    return new Container<T>()
  }

  static of<T>(...items: T[]): Container<T> {
    return new Container<T>(items)
  }

  static from<T>(iterable: Iterable<T>): Container<T> {
    return new Container<T>(Array.from(iterable))
  }

  add(item: T): this {
    this.items.push(item)
    return this
  }

  map<U>(fn: (item: T) => U): Container<U> {
    return Container.of(...this.items.map(fn))
  }

  filter(predicate: (item: T) => boolean): Container<T> {
    return Container.of(...this.items.filter(predicate))
  }

  reduce<U>(fn: (acc: U, item: T) => U, initial: U): U {
    return this.items.reduce(fn, initial)
  }

  get size(): number {
    return this.items.length
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]()
  }
}

/**
 * Mixin pattern - Serializable
 */
export interface Serializable {
  serialize(): string
  deserialize(data: string): void
}

/**
 * Class implementing interface with index signature
 */
export class DataStore implements Serializable {
  [key: string]: unknown

  serialize(): string {
    return JSON.stringify(this)
  }

  deserialize(data: string): void {
    Object.assign(this, JSON.parse(data))
  }
}

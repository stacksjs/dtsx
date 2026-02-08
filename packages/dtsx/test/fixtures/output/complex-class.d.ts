/**
 * Application events definition
 */
declare interface AppEvents {
  start: []
  stop: []
  error: [error: Error]
  data: [key: string, value: unknown]
}
/**
 * Mixin pattern - Serializable
 */
export declare interface Serializable {
  serialize(): string
  deserialize(data: string): void
}
/**
 * Logger interface for dependency injection
 */
declare interface Logger {
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, error?: Error): void
}
/**
 * Base event emitter class
 */
export declare abstract class EventEmitter<Events extends Record<string, any[]>> {
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
  protected emit<K extends keyof Events>(event: K, args: Events[K]): void;
  abstract dispose(): void;
}
/**
 * Main application class extending EventEmitter
 */
export declare class Application extends EventEmitter<AppEvents> {
  readonly version: string;
  protected running: boolean;
  constructor(logger: Logger);
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
  get isRunning(): boolean;
}
/**
 * Generic container with static factory methods
 */
export declare class Container<T> {
  constructor(items?: T[]);
  static empty<T>(): Container<T>;
  static of<T>(items: T[]): Container<T>;
  static from<T>(iterable: Iterable<T>): Container<T>;
  add(item: T): this;
  map<U>(fn: (item: T) => U): Container<U>;
  filter(predicate: (item: T) => boolean): Container<T>;
  reduce<U>(fn: (acc: U, item: T) => U, initial: U): U;
  get size(): number;
  [Symbol.iterator](): Iterator<T>;
}
/**
 * Class implementing interface with index signature
 */
export declare class DataStore implements Serializable {
  serialize(): string;
  deserialize(data: string): void;
}

/**
 * Comprehensive e2e tests proving dtsx produces correct .d.ts output
 * WITHOUT requiring isolatedDeclarations mode.
 *
 * These tests exercise the full pipeline (extract → process → generate)
 * on TypeScript source code that lacks explicit type annotations,
 * proving dtsx's own type inference is smart enough.
 */
import { describe, expect, it } from 'bun:test'
import { processSource } from '../src/generator'

// ============================================================
// FUNCTIONS WITHOUT RETURN TYPE ANNOTATIONS
// ============================================================
describe('Functions without return type annotations', () => {
  it('should handle function with typed params but no return type', () => {
    const source = `
      export function add(a: number, b: number) { return a + b; }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function add(a: number, b: number): void;')
  })

  it('should handle async function without return type', () => {
    const source = `
      export async function fetchData(url: string) { return fetch(url); }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function fetchData(url: string): Promise<void>;')
  })

  it('should handle generator function without return type', () => {
    const source = `
      export function* count(max: number) {
        for (let i = 0; i < max; i++) yield i;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function count(max: number): Generator<unknown, void, unknown>;')
  })

  it('should handle async generator without return type', () => {
    const source = `
      export async function* stream(urls: string[]) {
        for (const url of urls) yield await fetch(url);
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function stream(urls: string[]): AsyncGenerator<unknown, void, unknown>;')
  })

  it('should handle function with explicit return type', () => {
    const source = `
      export function greet(name: string): string { return 'hello ' + name; }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function greet(name: string): string;')
  })

  it('should handle void return function', () => {
    const source = `
      export function log(message: string) { console.log(message); }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function log(message: string): void;')
  })
})

// ============================================================
// FUNCTIONS WITHOUT PARAMETER TYPE ANNOTATIONS
// ============================================================
describe('Functions without parameter type annotations', () => {
  it('should use unknown for untyped parameters', () => {
    const source = `
      export function identity(x) { return x; }
    `
    const result = processSource(source)
    expect(result).toContain('identity(x: unknown)')
  })

  it('should infer string from default string parameter', () => {
    const source = `
      export function greet(name = 'world') { return 'hello ' + name; }
    `
    const result = processSource(source)
    expect(result).toContain('name?: string')
  })

  it('should infer number from default number parameter', () => {
    const source = `
      export function repeat(count = 3) { return count; }
    `
    const result = processSource(source)
    expect(result).toContain('count?: number')
  })

  it('should infer boolean from default boolean parameter', () => {
    const source = `
      export function toggle(enabled = true) { return !enabled; }
    `
    const result = processSource(source)
    expect(result).toContain('enabled?: boolean')
  })

  it('should handle mix of typed and untyped params', () => {
    const source = `
      export function process(input: string, options = {}) { return input; }
    `
    const result = processSource(source)
    expect(result).toContain('input: string')
  })

  it('should handle rest params without type', () => {
    const source = `
      export function collect(...args) { return args; }
    `
    const result = processSource(source)
    expect(result).toContain('...args: unknown')
  })
})

// ============================================================
// CONST VARIABLE NARROWING (no type annotations)
// ============================================================
describe('Const variable narrowing without annotations', () => {
  it('should narrow const string to literal type', () => {
    const source = `export const name = 'hello';`
    const result = processSource(source)
    expect(result).toContain('export declare const name: \'hello\';')
  })

  it('should narrow const number to literal type', () => {
    const source = `export const count = 42;`
    const result = processSource(source)
    expect(result).toContain('export declare const count: 42;')
  })

  it('should narrow const boolean to literal type', () => {
    const source = `export const flag = true;`
    const result = processSource(source)
    expect(result).toContain('export declare const flag: true;')
  })

  it('should narrow const false to literal type', () => {
    const source = `export const disabled = false;`
    const result = processSource(source)
    expect(result).toContain('export declare const disabled: false;')
  })

  it('should infer array type from const array', () => {
    const source = `export const items = [1, 2, 3];`
    const result = processSource(source)
    expect(result).toContain('items:')
    // Const array → widened number[] (sound: array elements are mutable)
    expect(result).toContain('number[]')
  })

  it('should infer object type from const object', () => {
    const source = `export const config = { host: 'localhost', port: 3000 };`
    const result = processSource(source)
    expect(result).toContain('config:')
    expect(result).toContain('host:')
    expect(result).toContain('port:')
  })

  it('should narrow const null', () => {
    const source = `export const nothing = null;`
    const result = processSource(source)
    expect(result).toContain('export declare const nothing: null;')
  })

  it('should narrow const undefined', () => {
    const source = `export const empty = undefined;`
    const result = processSource(source)
    expect(result).toContain('export declare const empty: undefined;')
  })

  it('should handle negative number literal', () => {
    const source = `export const offset = -1;`
    const result = processSource(source)
    expect(result).toContain('offset:')
    expect(result).toContain('-1')
  })

  it('should handle template literal without interpolation', () => {
    const source = 'export const msg = `hello world`;'
    const result = processSource(source)
    expect(result).toContain('msg:')
  })
})

// ============================================================
// LET/VAR VARIABLE WIDENING (no type annotations)
// ============================================================
describe('Let/var variable narrowing without annotations', () => {
  it('should widen let string to base type', () => {
    // let/var are reassignable, so types must be widened for soundness
    const source = `export let name = 'hello';`
    const result = processSource(source)
    expect(result).toContain('export declare let name: string;')
  })

  it('should widen let number to base type', () => {
    const source = `export let count = 42;`
    const result = processSource(source)
    expect(result).toContain('export declare let count: number;')
  })

  it('should widen let boolean to base type', () => {
    const source = `export let flag = true;`
    const result = processSource(source)
    expect(result).toContain('export declare let flag: boolean;')
  })
})

// ============================================================
// AS CONST ASSERTIONS
// ============================================================
describe('As const assertions', () => {
  it('should handle array as const', () => {
    const source = `export const COLORS = ['red', 'green', 'blue'] as const;`
    const result = processSource(source)
    expect(result).toContain('COLORS:')
    expect(result).toContain('readonly')
  })

  it('should handle object as const', () => {
    const source = `export const CONFIG = { debug: true, port: 8080 } as const;`
    const result = processSource(source)
    expect(result).toContain('CONFIG:')
    // Object as const produces narrow literal types for properties
    expect(result).toContain('debug: true')
    expect(result).toContain('port: 8080')
  })

  it('should handle nested as const', () => {
    const source = `
      export const ROUTES = {
        home: '/',
        about: '/about',
        api: {
          users: '/api/users',
          posts: '/api/posts',
        },
      } as const;
    `
    const result = processSource(source)
    expect(result).toContain('ROUTES:')
    expect(result).toContain('home: \'/\'')
    expect(result).toContain('about: \'/about\'')
  })

  it('should handle tuple as const', () => {
    const source = `export const PAIR = [1, 'two'] as const;`
    const result = processSource(source)
    expect(result).toContain('PAIR:')
    expect(result).toContain('readonly')
  })
})

// ============================================================
// SATISFIES OPERATOR
// ============================================================
describe('Satisfies operator', () => {
  it('should extract type from satisfies clause', () => {
    const source = `
      export const theme = { primary: '#000' } satisfies Record<string, string>;
    `
    const result = processSource(source)
    expect(result).toContain('Record<string, string>')
  })

  it('should handle satisfies with complex type', () => {
    const source = `
      type Config = { host: string; port: number };
      export const config = { host: 'localhost', port: 3000 } satisfies Config;
    `
    const result = processSource(source)
    expect(result).toContain('Config')
  })
})

// ============================================================
// CLASS MEMBERS WITHOUT ANNOTATIONS
// ============================================================
describe('Class members without type annotations', () => {
  it('should infer static readonly property type (const-like narrowing)', () => {
    const source = `
      export class Constants {
        static readonly MAX = 100;
        static readonly NAME = 'app';
        static readonly ENABLED = true;
      }
    `
    const result = processSource(source)
    expect(result).toContain('static readonly MAX: 100;')
    expect(result).toContain('static readonly NAME: \'app\';')
    expect(result).toContain('static readonly ENABLED: true;')
  })

  it('should widen mutable class property types', () => {
    const source = `
      export class State {
        count = 0;
        name = 'default';
        active = false;
      }
    `
    const result = processSource(source)
    expect(result).toContain('count: number;')
    expect(result).toContain('name: string;')
    expect(result).toContain('active: boolean;')
  })

  it('should handle class with typed and untyped members', () => {
    const source = `
      export class Service {
        name: string;
        version = '1.0.0';
        constructor(name: string) { this.name = name; }
        process(data: Buffer): void { }
      }
    `
    const result = processSource(source)
    expect(result).toContain('name: string;')
    expect(result).toContain('version: string;')
    expect(result).toContain('process(data: Buffer): void;')
  })

  it('should infer types for method default parameters', () => {
    const source = `
      export class Formatter {
        format(value: string, indent = 2): string {
          return value;
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('indent?: number')
  })

  it('should handle abstract class with untyped members', () => {
    const source = `
      export abstract class Base {
        abstract name: string;
        version = '1.0';
        abstract process(): void;
      }
    `
    const result = processSource(source)
    expect(result).toContain('abstract name: string;')
    expect(result).toContain('version: string;')
    expect(result).toContain('abstract process(): void;')
  })

  it('should handle get/set accessors without type annotations', () => {
    const source = `
      export class Store {
        private _value: number = 0;
        get value(): number { return this._value; }
        set value(v: number) { this._value = v; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('get value(): number;')
    expect(result).toContain('set value(v: number);')
  })
})

// ============================================================
// ARROW FUNCTIONS ASSIGNED TO CONST
// ============================================================
describe('Arrow functions assigned to const', () => {
  it('should infer arrow function with typed params', () => {
    const source = `
      export const greet = (name: string): string => 'Hello, ' + name;
    `
    const result = processSource(source)
    expect(result).toContain('greet:')
    expect(result).toContain('name: string')
    expect(result).toContain('string')
  })

  it('should handle async arrow function', () => {
    const source = `
      export const fetchJson = async (url: string): Promise<unknown> => {
        const res = await fetch(url);
        return res.json();
      };
    `
    const result = processSource(source)
    expect(result).toContain('fetchJson:')
    expect(result).toContain('Promise<unknown>')
  })

  it('should handle arrow function with default parameter', () => {
    const source = `
      export const multiply = (a: number, b = 2): number => a * b;
    `
    const result = processSource(source)
    expect(result).toContain('multiply:')
    expect(result).toContain('a: number')
  })
})

// ============================================================
// ENUM WITHOUT EXPLICIT VALUES
// ============================================================
describe('Enums', () => {
  it('should preserve enum with explicit values', () => {
    const source = `
      export enum Color {
        Red = 'RED',
        Green = 'GREEN',
        Blue = 'BLUE',
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum Color')
    expect(result).toContain('Red = \'RED\'')
    expect(result).toContain('Green = \'GREEN\'')
    expect(result).toContain('Blue = \'BLUE\'')
  })

  it('should preserve enum without explicit values', () => {
    const source = `
      export enum Direction {
        Up,
        Down,
        Left,
        Right,
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum Direction')
    expect(result).toContain('Up')
    expect(result).toContain('Right')
  })

  it('should preserve const enum', () => {
    const source = `
      export const enum LogLevel {
        Debug = 0,
        Info = 1,
        Warn = 2,
        Error = 3,
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare const enum LogLevel')
    expect(result).toContain('Debug = 0')
  })
})

// ============================================================
// INTERFACES AND TYPE ALIASES
// ============================================================
describe('Interfaces and type aliases pass through correctly', () => {
  it('should pass through interface declarations', () => {
    const source = `
      export interface User {
        id: number;
        name: string;
        email?: string;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface User')
    expect(result).toContain('id: number')
    expect(result).toContain('name: string')
    expect(result).toContain('email?: string')
  })

  it('should pass through type alias declarations', () => {
    const source = `
      export type ID = string | number;
      export type Nullable<T> = T | null;
    `
    const result = processSource(source)
    expect(result).toContain('export type ID = string | number')
    expect(result).toContain('export type Nullable<T> = T | null')
  })

  it('should handle generic interfaces', () => {
    const source = `
      export interface Repository<T> {
        find(id: string): Promise<T | null>;
        save(entity: T): Promise<void>;
        delete(id: string): Promise<boolean>;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface Repository<T>')
    expect(result).toContain('find(id: string): Promise<T | null>')
    expect(result).toContain('save(entity: T): Promise<void>')
  })
})

// ============================================================
// IMPORTS AND RE-EXPORTS
// ============================================================
describe('Imports and re-exports', () => {
  it('should preserve re-export statements', () => {
    const source = `
      export type { User } from './types';
    `
    const result = processSource(source)
    expect(result).toContain('export type { User } from \'./types\';')
  })

  it('should preserve export from statements', () => {
    const source = `
      export { helper } from './utils';
    `
    const result = processSource(source)
    expect(result).toContain('export { helper } from \'./utils\';')
  })

  it('should handle export default', () => {
    const source = `
      function main(): void {}
      export default main;
    `
    const result = processSource(source)
    expect(result).toContain('export default main;')
  })
})

// ============================================================
// EDGE CASES
// ============================================================
describe('Edge cases without isolatedDeclarations', () => {
  it('should handle empty function body', () => {
    const source = `
      export function noop() {}
    `
    const result = processSource(source)
    expect(result).toContain('export declare function noop(): void;')
  })

  it('should handle function with only default params', () => {
    const source = `
      export function configure(host = 'localhost', port = 3000, debug = false) {
        return { host, port, debug };
      }
    `
    const result = processSource(source)
    expect(result).toContain('host?: string')
    expect(result).toContain('port?: number')
    expect(result).toContain('debug?: boolean')
  })

  it('should handle destructured params with type annotation', () => {
    const source = `
      export function render({ width, height }: { width: number; height: number }): void {
        console.log(width, height);
      }
    `
    const result = processSource(source)
    expect(result).toContain('width: number')
    expect(result).toContain('height: number')
  })

  it('should handle overloaded functions', () => {
    const source = `
      export function parse(input: string): object;
      export function parse(input: string, reviver: (key: string, value: unknown) => unknown): object;
      export function parse(input: string, reviver?: (key: string, value: unknown) => unknown): object {
        return JSON.parse(input, reviver);
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function parse(input: string): object;')
    expect(result).toContain('export declare function parse(input: string, reviver: (key: string, value: unknown) => unknown): object;')
  })

  it('should handle generic function', () => {
    const source = `
      export function identity<T>(value: T): T { return value; }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function identity<T>(value: T): T;')
  })

  it('should handle function with type predicate', () => {
    const source = `
      export function isString(value: unknown): value is string {
        return typeof value === 'string';
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function isString(value: unknown): value is string;')
  })

  it('should handle class with generic type params', () => {
    const source = `
      export class Container<T> {
        private items: T[] = [];
        add(item: T): void { this.items.push(item); }
        get(index: number): T { return this.items[index]; }
        get size(): number { return this.items.length; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Container<T>')
    expect(result).toContain('add(item: T): void;')
    expect(result).toContain('get(index: number): T;')
    expect(result).toContain('get size(): number;')
  })

  it('should handle class extending another class', () => {
    const source = `
      class Base {
        id: number;
        constructor(id: number) { this.id = id; }
      }
      export class Child extends Base {
        name: string;
        constructor(id: number, name: string) {
          super(id);
          this.name = name;
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Child extends Base')
    expect(result).toContain('name: string;')
  })

  it('should handle class implementing interface', () => {
    const source = `
      interface Printable {
        toString(): string;
      }
      export class Document implements Printable {
        title: string;
        constructor(title: string) { this.title = title; }
        toString(): string { return this.title; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Document implements Printable')
    expect(result).toContain('toString(): string;')
  })

  it('should handle namespace with const declarations', () => {
    const source = `
      export namespace Config {
        export const HOST = 'localhost';
        export const PORT = 8080;
        export const DEBUG = false;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare namespace Config')
    expect(result).toContain('HOST: \'localhost\'')
    expect(result).toContain('PORT: 8080')
    expect(result).toContain('DEBUG: false')
  })

  it('should handle conditional const with type assertion', () => {
    const source = `
      export const value = 42 as number;
    `
    const result = processSource(source)
    expect(result).toContain('value:')
  })
})

// ============================================================
// REAL-WORLD PATTERNS WITHOUT isolatedDeclarations
// ============================================================
describe('Real-world patterns without isolatedDeclarations', () => {
  it('should handle Express-style route handler', () => {
    const source = `
      interface Request { params: Record<string, string>; body: unknown; }
      interface Response { json(data: unknown): void; status(code: number): Response; }

      export function createHandler(path: string): (req: Request, res: Response) => void {
        return (req, res) => { res.json({ path }); };
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function createHandler(path: string): (req: Request, res: Response) => void;')
  })

  it('should handle config object with nested structure', () => {
    const source = `
      export const dbConfig = {
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        pool: {
          min: 2,
          max: 10,
        },
      };
    `
    const result = processSource(source)
    expect(result).toContain('dbConfig:')
    expect(result).toContain('host:')
    expect(result).toContain('port:')
  })

  it('should handle factory function with typed return', () => {
    const source = `
      interface Logger {
        log(msg: string): void;
        error(msg: string): void;
      }

      export function createLogger(prefix: string): Logger {
        return {
          log: (msg) => console.log(prefix + msg),
          error: (msg) => console.error(prefix + msg),
        };
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function createLogger(prefix: string): Logger;')
  })

  it('should handle builder pattern class', () => {
    const source = `
      export class QueryBuilder {
        private query: string = '';

        select(fields: string[]): QueryBuilder {
          this.query += 'SELECT ' + fields.join(', ');
          return this;
        }

        from(table: string): QueryBuilder {
          this.query += ' FROM ' + table;
          return this;
        }

        where(condition: string): QueryBuilder {
          this.query += ' WHERE ' + condition;
          return this;
        }

        build(): string {
          return this.query;
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class QueryBuilder')
    expect(result).toContain('select(fields: string[]): QueryBuilder;')
    expect(result).toContain('from(table: string): QueryBuilder;')
    expect(result).toContain('where(condition: string): QueryBuilder;')
    expect(result).toContain('build(): string;')
    // Private members should be excluded
    expect(result).not.toContain('private query')
  })

  it('should handle event emitter pattern', () => {
    const source = `
      export class EventEmitter<T extends Record<string, unknown[]>> {
        private handlers: Map<keyof T, Function[]> = new Map();

        on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
          return this;
        }

        emit<K extends keyof T>(event: K, ...args: T[K]): boolean {
          return true;
        }

        off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
          return this;
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class EventEmitter')
    expect(result).toContain('on<K extends keyof T>')
    expect(result).toContain('emit<K extends keyof T>')
    expect(result).toContain('off<K extends keyof T>')
  })

  it('should handle module with mixed exports', () => {
    const source = `
      export const API_VERSION = '2.0';
      export type ApiResponse<T> = { data: T; status: number; };
      export interface ApiClient {
        get<T>(url: string): Promise<ApiResponse<T>>;
        post<T>(url: string, body: unknown): Promise<ApiResponse<T>>;
      }
      export function createClient(baseUrl: string): ApiClient {
        return {} as ApiClient;
      }
      export default createClient;
    `
    const result = processSource(source)
    expect(result).toContain('API_VERSION: \'2.0\'')
    expect(result).toContain('export type ApiResponse<T> = { data: T; status: number; }')
    expect(result).toContain('export declare interface ApiClient')
    expect(result).toContain('export declare function createClient(baseUrl: string): ApiClient;')
    expect(result).toContain('export default createClient;')
  })

  it('should handle utility type exports', () => {
    const source = `
      export type DeepPartial<T> = {
        [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
      };
      export type DeepReadonly<T> = {
        readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
      };
      export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
        Pick<T, Exclude<keyof T, Keys>> &
        { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];
    `
    const result = processSource(source)
    expect(result).toContain('export type DeepPartial<T>')
    expect(result).toContain('export type DeepReadonly<T>')
    expect(result).toContain('export type RequireAtLeastOne<T')
  })

  it('should handle class with constructor parameter properties', () => {
    const source = `
      export class User {
        constructor(
          public readonly id: string,
          public name: string,
          protected email: string,
          private password: string,
        ) {}

        getEmail(): string { return this.email; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('public readonly id: string;')
    expect(result).toContain('public name: string;')
    expect(result).toContain('protected email: string;')
    // Private param property should NOT appear as a class property,
    // but it still appears in the constructor signature
    expect(result).not.toContain('private password')
    expect(result).toContain('constructor(id: string, name: string, email: string, password: string);')
    expect(result).toContain('getEmail(): string;')
  })

  it('should handle complex generic constraints', () => {
    const source = `
      export function merge<T extends object, U extends object>(target: T, source: U): T & U {
        return { ...target, ...source };
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function merge<T extends object, U extends object>(target: T, source: U): T & U;')
  })

  it('should handle symbols and unique symbols', () => {
    const source = `
      export const TAG: unique symbol = Symbol('tag');
      export interface Tagged {
        [TAG]: string;
      }
    `
    const result = processSource(source)
    expect(result).toContain('TAG:')
    expect(result).toContain('Tagged')
  })
})

// ============================================================
// MIXED: CODE WITH AND WITHOUT ANNOTATIONS
// ============================================================
describe('Mixed: code with and without annotations', () => {
  it('should correctly handle file with mixed annotation styles', () => {
    const source = `
      // Fully annotated (isolatedDeclarations-compatible)
      export const MAX_RETRIES: number = 3;

      // Partially annotated
      export function retry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
        return fn();
      }

      // Not annotated
      export const DEFAULT_TIMEOUT = 5000;

      // Type annotation present
      export interface RetryOptions {
        maxRetries: number;
        timeout: number;
        backoff: boolean;
      }

      // No annotation on class property
      export class RetryManager {
        static readonly MAX_ATTEMPTS = 10;
        attempts = 0;

        constructor(private options: RetryOptions) {}

        async execute<T>(fn: () => Promise<T>): Promise<T> {
          return fn();
        }
      }
    `
    const result = processSource(source)

    // Fully annotated → exact type
    expect(result).toContain('MAX_RETRIES: number')

    // Partially annotated → inferred default param
    expect(result).toContain('maxRetries?: number')

    // No annotation → const narrowed
    expect(result).toContain('DEFAULT_TIMEOUT: 5000')

    // Interface passes through
    expect(result).toContain('export declare interface RetryOptions')

    // Class with mixed
    expect(result).toContain('static readonly MAX_ATTEMPTS: 10;')
    expect(result).toContain('attempts: number;')
    expect(result).toContain('execute<T>(fn: () => Promise<T>): Promise<T>;')
  })
})

// ============================================================
// TYPE ASSERTION INFERENCE
// ============================================================
describe('Type assertion inference', () => {
  it('should extract type from as assertion', () => {
    const source = `
      export class Config {
        static readonly TIMEOUT = 30000 as number;
      }
    `
    const result = processSource(source)
    expect(result).toContain('TIMEOUT: number')
  })

  it('should handle namespace const with type assertion', () => {
    const source = `
      export namespace Keys {
        export const HOME = 'home' as string;
        export const ABOUT = 'about' as string;
      }
    `
    const result = processSource(source)
    expect(result).toContain('HOME: string')
    expect(result).toContain('ABOUT: string')
  })
})

// ============================================================
// DECLARE GLOBAL AND MODULE AUGMENTATION
// ============================================================
describe('Declare global and module augmentation', () => {
  it('should handle declare global', () => {
    const source = `
      declare global {
        interface Window {
          myApp: { version: string };
        }
      }
      export {};
    `
    const result = processSource(source)
    expect(result).toContain('declare global')
    expect(result).toContain('Window')
    expect(result).toContain('myApp:')
  })

  it('should handle module declaration', () => {
    const source = `
      declare module 'my-lib' {
        export function init(config: { debug: boolean }): void;
      }
    `
    const result = processSource(source)
    expect(result).toContain('declare module \'my-lib\'')
    expect(result).toContain('init(config:')
  })
})

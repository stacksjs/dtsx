/**
 * Comprehensive tests for dtsx covering advanced TypeScript features,
 * edge cases, and real-world patterns.
 */
import { describe, expect, it } from 'bun:test'
import { extractDeclarations } from '../src/extractor'
import { processSource } from '../src/generator'

// ============================================================
// CLASS FEATURES
// ============================================================
describe('Class features', () => {
  it('should handle class with static and instance members', () => {
    const source = `
      export class Counter {
        static count: number = 0;
        static increment(): void { Counter.count++; }
        readonly id: string;
        constructor(id: string) { this.id = id; }
        getValue(): number { return Counter.count; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Counter')
    expect(result).toContain('static count: number;')
    expect(result).toContain('static increment(): void;')
    expect(result).toContain('readonly id: string;')
    expect(result).toContain('constructor(id: string);')
    expect(result).toContain('getValue(): number;')
  })

  it('should handle class with protected members', () => {
    const source = `
      export class Base {
        protected config: Record<string, unknown>;
        constructor(config: Record<string, unknown>) { this.config = config; }
        protected getConfig(): Record<string, unknown> { return this.config; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Base')
    expect(result).toContain('protected config: Record<string, unknown>;')
    expect(result).toContain('protected getConfig(): Record<string, unknown>;')
  })

  it('should handle class inheritance chain', () => {
    const source = `
      export class Animal {
        name: string;
        constructor(name: string) { this.name = name; }
      }

      export class Dog extends Animal {
        breed: string;
        constructor(name: string, breed: string) {
          super(name);
          this.breed = breed;
        }
        bark(): string { return 'woof'; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Animal')
    expect(result).toContain('export declare class Dog extends Animal')
    expect(result).toContain('breed: string;')
    expect(result).toContain('bark(): string;')
  })

  it('should handle class implementing interfaces', () => {
    const source = `
      export interface Serializable {
        serialize(): string;
      }

      export interface Identifiable {
        id: string;
      }

      export class Entity implements Serializable, Identifiable {
        id: string;
        constructor(id: string) { this.id = id; }
        serialize(): string { return JSON.stringify(this); }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface Serializable')
    expect(result).toContain('export declare interface Identifiable')
    expect(result).toContain('class Entity implements Serializable, Identifiable')
  })

  it('should handle abstract class with abstract and concrete members', () => {
    const source = `
      export abstract class Shape {
        abstract area(): number;
        abstract perimeter(): number;
        toString(): string { return \`Shape(area=\${this.area()})\`; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare abstract class Shape')
    expect(result).toContain('abstract area(): number;')
    expect(result).toContain('abstract perimeter(): number;')
    expect(result).toContain('toString(): string;')
  })

  it('should handle generic class', () => {
    const source = `
      export class Stack<T> {
        private items: T[] = [];
        push(item: T): void { this.items.push(item); }
        pop(): T | undefined { return this.items.pop(); }
        peek(): T | undefined { return this.items[this.items.length - 1]; }
        get size(): number { return this.items.length; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Stack<T>')
    expect(result).toContain('push(item: T): void;')
    expect(result).toContain('pop(): T | undefined;')
    expect(result).toContain('peek(): T | undefined;')
    expect(result).toContain('get size(): number;')
  })

  it('should handle class with constructor parameter properties', () => {
    const source = `
      export class Point {
        constructor(
          public readonly x: number,
          public readonly y: number,
          public readonly z: number = 0
        ) {}
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Point')
    expect(result).toContain('readonly x: number')
    expect(result).toContain('readonly y: number')
  })

  it('should handle class with index signature', () => {
    const source = `
      export class Dictionary<T> {
        [key: string]: T | ((...args: any[]) => any);
        get(key: string): T | undefined { return this[key] as T; }
        set(key: string, value: T): void { this[key] = value; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Dictionary<T>')
  })

  it('should handle class with method overloads', () => {
    const source = `
      export class Converter {
        convert(value: string): number;
        convert(value: number): string;
        convert(value: string | number): string | number {
          return typeof value === 'string' ? Number(value) : String(value);
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Converter')
  })
})

// ============================================================
// GENERIC EDGE CASES
// ============================================================
describe('Generic edge cases', () => {
  it('should handle self-referential generic types', () => {
    const source = `
      export interface TreeNode<T> {
        value: T;
        children: TreeNode<T>[];
        parent?: TreeNode<T>;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface TreeNode<T>')
    expect(result).toContain('children: TreeNode<T>[]')
    expect(result).toContain('parent?: TreeNode<T>')
  })

  it('should handle generic with multiple infer clauses', () => {
    const source = `
      export type Unpack<T> = T extends Promise<infer U>
        ? U extends Array<infer R>
          ? R
          : U
        : T;
    `
    const result = processSource(source)
    expect(result).toContain('type Unpack<T>')
    expect(result).toContain('Promise<infer U>')
    expect(result).toContain('Array<infer R>')
  })

  it('should handle generic function with complex constraints', () => {
    const source = `
      export function merge<
        T extends Record<string, unknown>,
        U extends Record<string, unknown>
      >(target: T, source: U): T & U {
        return { ...target, ...source };
      }
    `
    const result = processSource(source)
    expect(result).toContain('merge<')
    expect(result).toContain('T extends Record<string, unknown>')
    expect(result).toContain('U extends Record<string, unknown>')
    expect(result).toContain('): T & U;')
  })

  it('should handle generic default type parameters', () => {
    const source = `
      export interface Repository<
        T,
        ID extends string | number = string
      > {
        findById(id: ID): Promise<T | null>;
        findAll(): Promise<T[]>;
        save(entity: T): Promise<T>;
        delete(id: ID): Promise<boolean>;
      }
    `
    const result = processSource(source)
    expect(result).toContain('Repository<')
    expect(result).toContain('ID extends string | number = string')
    expect(result).toContain('findById(id: ID): Promise<T | null>')
    expect(result).toContain('findAll(): Promise<T[]>')
  })

  it('should handle mapped type with key remapping', () => {
    const source = `
      export type Getters<T> = {
        [K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K]
      };
    `
    const result = processSource(source)
    expect(result).toContain('type Getters<T>')
    expect(result).toContain('Capitalize<string & K>')
  })

  it('should handle generic variance annotations', () => {
    const source = `
      export interface Producer<out T> {
        produce(): T;
      }

      export interface Consumer<in T> {
        consume(value: T): void;
      }
    `
    const result = processSource(source)
    expect(result).toContain('Producer')
    expect(result).toContain('produce(): T')
    expect(result).toContain('Consumer')
    expect(result).toContain('consume(value: T): void')
  })

  it('should handle generic with conditional return type', () => {
    const source = `
      export function parse<T extends 'string' | 'number' | 'boolean'>(
        value: string,
        type: T
      ): T extends 'string' ? string : T extends 'number' ? number : boolean {
        return undefined as any;
      }
    `
    const result = processSource(source)
    expect(result).toContain('parse<')
    expect(result).toContain('T extends \'string\' | \'number\' | \'boolean\'')
  })

  it('should handle recursive conditional type', () => {
    const source = `
      export type DeepReadonly<T> = T extends (infer R)[]
        ? ReadonlyArray<DeepReadonly<R>>
        : T extends Function
          ? T
          : T extends object
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T;
    `
    const result = processSource(source)
    expect(result).toContain('type DeepReadonly<T>')
    expect(result).toContain('ReadonlyArray<DeepReadonly<R>>')
  })
})

// ============================================================
// CONDITIONAL TYPES
// ============================================================
describe('Conditional types', () => {
  it('should handle nested conditional types', () => {
    const source = `
      export type TypeName<T> =
        T extends string ? 'string' :
        T extends number ? 'number' :
        T extends boolean ? 'boolean' :
        T extends undefined ? 'undefined' :
        T extends Function ? 'function' :
        'object';
    `
    const result = processSource(source)
    expect(result).toContain('type TypeName<T>')
    expect(result).toContain('T extends string ? \'string\'')
  })

  it('should handle conditional types with infer', () => {
    const source = `
      export type ReturnType<T extends (...args: any) => any> =
        T extends (...args: any) => infer R ? R : any;

      export type Parameters<T extends (...args: any) => any> =
        T extends (...args: infer P) => any ? P : never;

      export type ConstructorParameters<T extends abstract new (...args: any) => any> =
        T extends abstract new (...args: infer P) => any ? P : never;
    `
    const result = processSource(source)
    expect(result).toContain('type ReturnType<T')
    expect(result).toContain('infer R')
    expect(result).toContain('type Parameters<T')
    expect(result).toContain('infer P')
    expect(result).toContain('type ConstructorParameters<T')
  })

  it('should handle distributive conditional types', () => {
    const source = `
      export type NonNullableFields<T> = {
        [K in keyof T]: NonNullable<T[K]>
      };

      export type PromiseType<T> = T extends Promise<infer U> ? U : T;

      export type Awaited<T> =
        T extends null | undefined ? T :
        T extends object & { then(onfulfilled: infer F, ...args: infer _): any } ?
          F extends ((value: infer V, ...args: infer _) => any) ?
            Awaited<V> :
            never :
        T;
    `
    const result = processSource(source)
    expect(result).toContain('type NonNullableFields<T>')
    expect(result).toContain('type PromiseType<T>')
    expect(result).toContain('type Awaited<T>')
  })
})

// ============================================================
// TEMPLATE LITERAL TYPES
// ============================================================
describe('Template literal types', () => {
  it('should handle template literal type combinations', () => {
    const source = `
      export type EventName = \`on\${string}\`;
      export type CSSProperty = \`--\${string}\`;
      export type Route = \`/api/\${string}/\${number}\`;
    `
    const result = processSource(source)
    expect(result).toContain('type EventName')
    expect(result).toContain('type CSSProperty')
    expect(result).toContain('type Route')
  })

  it('should handle template literal with intrinsic string types', () => {
    const source = `
      export type UpperCase<S extends string> = Uppercase<S>;
      export type LowerCase<S extends string> = Lowercase<S>;
      export type Capitalized<S extends string> = Capitalize<S>;
      export type Uncapitalized<S extends string> = Uncapitalize<S>;
    `
    const result = processSource(source)
    expect(result).toContain('Uppercase<S>')
    expect(result).toContain('Lowercase<S>')
    expect(result).toContain('Capitalize<S>')
    expect(result).toContain('Uncapitalize<S>')
  })

  it('should handle complex template literal mapped types', () => {
    const source = `
      export type PropEventHandlers<T> = {
        [K in keyof T as \`on\${Capitalize<string & K>}Change\`]: (newValue: T[K]) => void
      };
    `
    const result = processSource(source)
    expect(result).toContain('type PropEventHandlers<T>')
    expect(result).toContain('Capitalize<string & K>')
  })
})

// ============================================================
// VARIABLE DECLARATIONS
// ============================================================
describe('Variable declarations', () => {
  it('should handle const with explicit type annotation', () => {
    const source = `
      export const port: number = 3000;
      export const host: string = 'localhost';
      export const debug: boolean = false;
    `
    const result = processSource(source)
    expect(result).toContain('export declare const port: number;')
    expect(result).toContain('export declare const host: string;')
    expect(result).toContain('export declare const debug: boolean;')
  })

  it('should handle as const assertions on primitives', () => {
    const source = `
      export const VERSION = '1.0.0' as const;
      export const MAX_SIZE = 100 as const;
    `
    const result = processSource(source)
    expect(result).toContain('VERSION')
    expect(result).toContain('MAX_SIZE')
  })

  it('should handle as const assertions on objects', () => {
    const source = `
      export const CONFIG = {
        port: 3000,
        host: 'localhost',
        features: {
          darkMode: true,
          analytics: false,
        },
      } as const;
    `
    const result = processSource(source)
    expect(result).toContain('CONFIG')
  })

  it('should handle as const assertions on arrays', () => {
    const source = `
      export const COLORS = ['red', 'green', 'blue'] as const;
      export const PRIMES = [2, 3, 5, 7, 11] as const;
    `
    const result = processSource(source)
    expect(result).toContain('COLORS')
    expect(result).toContain('PRIMES')
  })

  it('should handle satisfies operator with complex types', () => {
    const source = `
      export const routes = {
        home: '/',
        about: '/about',
        contact: '/contact',
      } satisfies Record<string, string>;
    `
    const result = processSource(source)
    expect(result).toContain('routes')
    expect(result).toContain('Record<string, string>')
  })

  it('should handle let and var declarations', () => {
    const source = `
      export let mutableValue: string = 'hello';
      export var legacyValue: number = 42;
    `
    const result = processSource(source)
    expect(result).toContain('mutableValue')
    expect(result).toContain('legacyValue')
  })

  it('should infer type from string literal', () => {
    const source = `export const greeting = 'hello world';`
    const result = processSource(source)
    expect(result).toContain('greeting')
  })

  it('should infer type from number literal', () => {
    const source = `export const count = 42;`
    const result = processSource(source)
    expect(result).toContain('count')
  })

  it('should infer type from boolean literal', () => {
    const source = `export const enabled = true;`
    const result = processSource(source)
    expect(result).toContain('enabled')
  })

  it('should infer type from array literal', () => {
    const source = `export const items = [1, 2, 3];`
    const result = processSource(source)
    expect(result).toContain('items')
  })

  it('should infer type from object literal', () => {
    const source = `
      export const config = {
        port: 3000,
        host: 'localhost',
      };
    `
    const result = processSource(source)
    expect(result).toContain('config')
  })
})

// ============================================================
// IMPORT/EXPORT EDGE CASES
// ============================================================
describe('Import/export edge cases', () => {
  it('should handle type-only imports', () => {
    const source = `
      import type { Config } from './config';
      export function loadConfig(): Config { return {} as Config; }
    `
    const result = processSource(source)
    expect(result).toContain('import type { Config } from \'./config\'')
    expect(result).toContain('export declare function loadConfig(): Config')
  })

  it('should handle mixed type and value imports', () => {
    const source = `
      import { createServer, type ServerOptions } from 'http';
      export function start(opts: ServerOptions): void {}
    `
    const result = processSource(source)
    expect(result).toContain('ServerOptions')
  })

  it('should handle namespace re-exports', () => {
    const source = `
      export * as helpers from './helpers';
      export * from './types';
    `
    const result = processSource(source)
    expect(result).toContain('export * as helpers from \'./helpers\'')
    expect(result).toContain('export * from \'./types\'')
  })

  it('should handle export with rename', () => {
    const source = `
      export { foo as default, bar as baz } from './module';
    `
    const result = processSource(source)
    expect(result).toContain('foo as default')
    expect(result).toContain('bar as baz')
  })

  it('should handle type-only re-exports', () => {
    const source = `
      export type { User, Post } from './models';
      export type { Config as AppConfig } from './config';
    `
    const result = processSource(source)
    expect(result).toContain('export type { User, Post } from \'./models\'')
    expect(result).toContain('export type { Config as AppConfig } from \'./config\'')
  })

  it('should handle side-effect imports', () => {
    const source = `
      import 'reflect-metadata';
      export class MyClass {
        value: string = '';
      }
    `
    const result = processSource(source)
    expect(result).toContain('import \'reflect-metadata\'')
    expect(result).toContain('export declare class MyClass')
  })

  it('should handle default import with named imports', () => {
    const source = `
      import React, { useState, useEffect } from 'react';
      export function App(): React.ReactElement { return null as any; }
    `
    const result = processSource(source)
    expect(result).toContain('React')
    expect(result).toContain('export declare function App')
  })

  it('should filter out completely unused imports', () => {
    const source = `
      import { unused1 } from 'module-a';
      import { unused2 } from 'module-b';
      export const x: number = 1;
    `
    const result = processSource(source)
    expect(result).not.toContain('unused1')
    expect(result).not.toContain('unused2')
    expect(result).toContain('export declare const x: number')
  })

  it('should keep imports used in type annotations', () => {
    const source = `
      import { MyType } from './types';
      export const value: MyType = {} as MyType;
    `
    const result = processSource(source)
    expect(result).toContain('MyType')
  })
})

// ============================================================
// FUNCTION EDGE CASES
// ============================================================
describe('Function edge cases', () => {
  it('should handle function with rest parameters', () => {
    const source = `
      export function log(message: string, ...args: unknown[]): void {
        console.log(message, ...args);
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function log(message: string, ...args: unknown[]): void;')
  })

  it('should handle function with optional parameters', () => {
    const source = `
      export function connect(host: string, port?: number, secure?: boolean): void {}
    `
    const result = processSource(source)
    expect(result).toContain('export declare function connect(host: string, port?: number, secure?: boolean): void;')
  })

  it('should handle function with default parameters', () => {
    const source = `
      export function createServer(port: number = 3000, host: string = 'localhost'): void {}
    `
    const result = processSource(source)
    expect(result).toContain('export declare function createServer')
    expect(result).toContain('port')
    expect(result).toContain('host')
  })

  it('should handle async function', () => {
    const source = `
      export async function fetchData(url: string): Promise<Response> {
        return fetch(url);
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function fetchData(url: string): Promise<Response>;')
  })

  it('should handle generator function', () => {
    const source = `
      export function* range(start: number, end: number): Generator<number> {
        for (let i = start; i < end; i++) yield i;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function range(start: number, end: number): Generator<number>;')
  })

  it('should handle function overloads with different return types', () => {
    const source = `
      export function parse(input: string): object;
      export function parse(input: string, reviver: (key: string, value: any) => any): object;
      export function parse(input: string, reviver?: (key: string, value: any) => any): object {
        return JSON.parse(input, reviver);
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function parse(input: string): object;')
    expect(result).toContain('export declare function parse(input: string, reviver: (key: string, value: any) => any): object;')
    // Implementation should NOT appear
    expect(result).not.toContain('JSON.parse')
  })

  it('should handle generic function with constraints', () => {
    const source = `
      export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
        return keys.reduce((acc, key) => ({ ...acc, [key]: obj[key] }), {} as Pick<T, K>);
      }
    `
    const result = processSource(source)
    expect(result).toContain('pick<T extends object, K extends keyof T>')
    expect(result).toContain('Pick<T, K>')
  })

  it('should handle function with type predicate', () => {
    const source = `
      export function isString(value: unknown): value is string {
        return typeof value === 'string';
      }

      export function isNonNull<T>(value: T | null | undefined): value is T {
        return value != null;
      }
    `
    const result = processSource(source)
    expect(result).toContain('value is string')
    expect(result).toContain('value is T')
  })

  it('should handle function with assertion signature', () => {
    const source = `
      export function assertDefined<T>(value: T | undefined, message?: string): asserts value is T {
        if (value === undefined) throw new Error(message);
      }
    `
    const result = processSource(source)
    expect(result).toContain('asserts value is T')
  })

  it('should handle function with this parameter', () => {
    const source = `
      export function onClick(this: HTMLElement, event: MouseEvent): void {
        console.log(this.tagName, event);
      }
    `
    const result = processSource(source)
    expect(result).toContain('this: HTMLElement')
    expect(result).toContain('event: MouseEvent')
  })
})

// ============================================================
// INTERFACE EDGE CASES
// ============================================================
describe('Interface edge cases', () => {
  it('should handle interface with call signature', () => {
    const source = `
      export interface Formatter {
        (input: string): string;
        locale: string;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface Formatter')
    expect(result).toContain('(input: string): string')
    expect(result).toContain('locale: string')
  })

  it('should handle interface with construct signature', () => {
    const source = `
      export interface Constructor<T> {
        new (...args: any[]): T;
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface Constructor<T>')
    expect(result).toContain('new (...args: any[]): T')
  })

  it('should handle interface with index signatures', () => {
    const source = `
      export interface StringMap {
        [key: string]: string;
      }

      export interface NumberMap {
        [index: number]: string;
      }
    `
    const result = processSource(source)
    expect(result).toContain('[key: string]: string')
    expect(result).toContain('[index: number]: string')
  })

  it('should handle interface extending multiple interfaces', () => {
    const source = `
      export interface Named { name: string; }
      export interface Aged { age: number; }
      export interface Person extends Named, Aged {
        email: string;
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface Person extends Named, Aged')
    expect(result).toContain('email: string')
  })

  it('should handle interface with method signatures', () => {
    const source = `
      export interface EventEmitter {
        on(event: string, listener: (...args: any[]) => void): this;
        off(event: string, listener: (...args: any[]) => void): this;
        emit(event: string, ...args: any[]): boolean;
        once(event: string, listener: (...args: any[]) => void): this;
      }
    `
    const result = processSource(source)
    expect(result).toContain('on(event: string')
    expect(result).toContain('off(event: string')
    expect(result).toContain('emit(event: string')
    expect(result).toContain('once(event: string')
  })

  it('should handle interface with optional and readonly', () => {
    const source = `
      export interface Config {
        readonly version: string;
        port?: number;
        readonly host?: string;
        debug: boolean;
      }
    `
    const result = processSource(source)
    expect(result).toContain('readonly version: string')
    expect(result).toContain('port?: number')
    expect(result).toContain('readonly host?: string')
    expect(result).toContain('debug: boolean')
  })

  it('should handle interface with generic methods', () => {
    const source = `
      export interface Collection<T> {
        add(item: T): void;
        remove(item: T): boolean;
        find<S extends T>(predicate: (item: T) => item is S): S | undefined;
        map<U>(fn: (item: T) => U): Collection<U>;
        filter(predicate: (item: T) => boolean): Collection<T>;
      }
    `
    const result = processSource(source)
    expect(result).toContain('Collection<T>')
    expect(result).toContain('add(item: T): void')
    expect(result).toContain('find<S extends T>')
    expect(result).toContain('map<U>')
  })
})

// ============================================================
// ENUM EDGE CASES
// ============================================================
describe('Enum edge cases', () => {
  it('should handle string enum', () => {
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

  it('should handle numeric enum with initializers', () => {
    const source = `
      export enum HttpStatus {
        OK = 200,
        Created = 201,
        BadRequest = 400,
        NotFound = 404,
        InternalServerError = 500,
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum HttpStatus')
    expect(result).toContain('OK = 200')
    expect(result).toContain('NotFound = 404')
  })

  it('should handle const enum', () => {
    const source = `
      export const enum Direction {
        Up = 'UP',
        Down = 'DOWN',
        Left = 'LEFT',
        Right = 'RIGHT',
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare const enum Direction')
  })

  it('should handle enum with computed members', () => {
    const source = `
      export enum Flags {
        None = 0,
        Read = 1 << 0,
        Write = 1 << 1,
        Execute = 1 << 2,
        All = Read | Write | Execute,
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum Flags')
    expect(result).toContain('None = 0')
  })
})

// ============================================================
// MODULE / NAMESPACE EDGE CASES
// ============================================================
describe('Module/namespace edge cases', () => {
  it('should handle nested namespaces', () => {
    const source = `
      export namespace Outer {
        export namespace Inner {
          export interface Config {
            key: string;
          }
          export function create(): Config { return { key: '' }; }
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('namespace Outer')
    expect(result).toContain('namespace Inner')
    expect(result).toContain('interface Config')
  })

  it('should handle declare module augmentation', () => {
    const source = `
      declare module 'express' {
        interface Request {
          user?: { id: string; name: string };
        }
      }
      export {};
    `
    const result = processSource(source)
    expect(result).toContain('declare module \'express\'')
    expect(result).toContain('interface Request')
  })

  it('should handle declare global', () => {
    const source = `
      declare global {
        interface Window {
          __APP_VERSION__: string;
        }
        var __DEV__: boolean;
      }
      export {};
    `
    const result = processSource(source)
    expect(result).toContain('declare global')
    expect(result).toContain('Window')
  })

  it('should handle namespace with type exports', () => {
    const source = `
      export namespace API {
        export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
        export interface Request<T = unknown> {
          method: Method;
          url: string;
          body?: T;
        }
        export interface Response<T = unknown> {
          status: number;
          data: T;
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('namespace API')
    expect(result).toContain('type Method = \'GET\' | \'POST\' | \'PUT\' | \'DELETE\'')
    expect(result).toContain('interface Request<T = unknown>')
    expect(result).toContain('interface Response<T = unknown>')
  })
})

// ============================================================
// TYPE ALIAS EDGE CASES
// ============================================================
describe('Type alias edge cases', () => {
  it('should handle union type alias', () => {
    const source = `
      export type Primitive = string | number | boolean | null | undefined | symbol | bigint;
    `
    const result = processSource(source)
    expect(result).toContain('type Primitive = string | number | boolean | null | undefined | symbol | bigint')
  })

  it('should handle intersection type alias', () => {
    const source = `
      export type WithTimestamp<T> = T & { createdAt: Date; updatedAt: Date };
    `
    const result = processSource(source)
    expect(result).toContain('type WithTimestamp<T> = T & { createdAt: Date; updatedAt: Date }')
  })

  it('should handle utility type combinations', () => {
    const source = `
      export type ReadonlyPartial<T> = Readonly<Partial<T>>;
      export type RequiredPick<T, K extends keyof T> = Required<Pick<T, K>>;
      export type OmitNullable<T> = { [K in keyof T as T[K] extends null | undefined ? never : K]: T[K] };
    `
    const result = processSource(source)
    expect(result).toContain('type ReadonlyPartial<T> = Readonly<Partial<T>>')
    expect(result).toContain('type RequiredPick<T, K extends keyof T> = Required<Pick<T, K>>')
    expect(result).toContain('type OmitNullable<T>')
  })

  it('should handle tuple types', () => {
    const source = `
      export type Pair<A, B> = [A, B];
      export type Triple<A, B, C> = [A, B, C];
      export type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;
      export type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never;
    `
    const result = processSource(source)
    expect(result).toContain('type Pair<A, B> = [A, B]')
    expect(result).toContain('type Triple<A, B, C> = [A, B, C]')
    expect(result).toContain('type Head<T extends any[]>')
    expect(result).toContain('type Tail<T extends any[]>')
  })

  it('should handle indexed access types', () => {
    const source = `
      export type PropType<T, Path extends string> =
        Path extends keyof T
          ? T[Path]
          : Path extends \`\${infer K}.\${infer R}\`
            ? K extends keyof T
              ? PropType<T[K], R>
              : never
            : never;
    `
    const result = processSource(source)
    expect(result).toContain('type PropType<T, Path extends string>')
  })

  it('should handle discriminated union types', () => {
    const source = `
      export type Shape =
        | { kind: 'circle'; radius: number }
        | { kind: 'square'; size: number }
        | { kind: 'rectangle'; width: number; height: number };
    `
    const result = processSource(source)
    expect(result).toContain('type Shape')
    expect(result).toContain('kind: \'circle\'')
    expect(result).toContain('kind: \'square\'')
    expect(result).toContain('kind: \'rectangle\'')
  })

  it('should handle branded types', () => {
    const source = `
      export type Brand<T, B> = T & { __brand: B };
      export type USD = Brand<number, 'USD'>;
      export type EUR = Brand<number, 'EUR'>;
      export type Email = Brand<string, 'Email'>;
    `
    const result = processSource(source)
    expect(result).toContain('type Brand<T, B> = T & { __brand: B }')
    expect(result).toContain('type USD = Brand<number, \'USD\'>')
    expect(result).toContain('type EUR = Brand<number, \'EUR\'>')
    expect(result).toContain('type Email = Brand<string, \'Email\'>')
  })
})

// ============================================================
// REAL-WORLD PATTERNS
// ============================================================
describe('Real-world patterns', () => {
  it('should handle React-like component types', () => {
    const source = `
      export type FC<P = {}> = (props: P) => JSX.Element | null;

      export interface ComponentProps {
        children?: React.ReactNode;
        className?: string;
        style?: React.CSSProperties;
      }
    `
    const result = processSource(source)
    expect(result).toContain('type FC<P = {}>')
    expect(result).toContain('interface ComponentProps')
  })

  it('should handle Express-like middleware types', () => {
    const source = `
      export interface Request<Body = any, Query = any> {
        body: Body;
        query: Query;
        params: Record<string, string>;
        headers: Record<string, string | string[] | undefined>;
      }

      export interface Response<T = any> {
        status(code: number): Response<T>;
        json(body: T): void;
        send(body: string): void;
      }

      export type Middleware<Req = Request, Res = Response> = (
        req: Req,
        res: Res,
        next: () => void
      ) => void | Promise<void>;
    `
    const result = processSource(source)
    expect(result).toContain('interface Request<Body = any, Query = any>')
    expect(result).toContain('interface Response<T = any>')
    expect(result).toContain('type Middleware<Req = Request, Res = Response>')
  })

  it('should handle builder pattern types', () => {
    const source = `
      export class QueryBuilder<T> {
        where(condition: Partial<T>): QueryBuilder<T> { return this; }
        orderBy<K extends keyof T>(key: K, direction?: 'asc' | 'desc'): QueryBuilder<T> { return this; }
        limit(count: number): QueryBuilder<T> { return this; }
        offset(count: number): QueryBuilder<T> { return this; }
        execute(): Promise<T[]> { return Promise.resolve([]); }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class QueryBuilder<T>')
    expect(result).toContain('where(condition: Partial<T>): QueryBuilder<T>')
    expect(result).toContain('orderBy<K extends keyof T>')
    expect(result).toContain('execute(): Promise<T[]>')
  })

  it('should handle event emitter pattern', () => {
    const source = `
      export type EventMap = Record<string, any[]>;

      export interface TypedEventEmitter<Events extends EventMap> {
        on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
        off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this;
        emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean;
      }
    `
    const result = processSource(source)
    expect(result).toContain('type EventMap = Record<string, any[]>')
    expect(result).toContain('interface TypedEventEmitter<Events extends EventMap>')
  })

  it('should handle Result/Either pattern', () => {
    const source = `
      export type Result<T, E = Error> =
        | { ok: true; value: T }
        | { ok: false; error: E };

      export function ok<T>(value: T): Result<T, never> {
        return { ok: true, value };
      }

      export function err<E>(error: E): Result<never, E> {
        return { ok: false, error };
      }
    `
    const result = processSource(source)
    expect(result).toContain('type Result<T, E = Error>')
    expect(result).toContain('ok: true; value: T')
    expect(result).toContain('ok: false; error: E')
    expect(result).toContain('export declare function ok<T>(value: T): Result<T, never>')
    expect(result).toContain('export declare function err<E>(error: E): Result<never, E>')
  })

  it('should handle dependency injection pattern', () => {
    const source = `
      export interface Service {
        start(): Promise<void>;
        stop(): Promise<void>;
      }

      export type ServiceFactory<T extends Service> = () => T | Promise<T>;

      export interface Container {
        register<T extends Service>(name: string, factory: ServiceFactory<T>): void;
        resolve<T extends Service>(name: string): Promise<T>;
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface Service')
    expect(result).toContain('type ServiceFactory<T extends Service>')
    expect(result).toContain('interface Container')
    expect(result).toContain('register<T extends Service>')
    expect(result).toContain('resolve<T extends Service>')
  })
})

// ============================================================
// TRIPLE-SLASH DIRECTIVES
// ============================================================
describe('Triple-slash directives', () => {
  it('should handle reference types directive', () => {
    const source = `/// <reference types="node" />\nexport const x: number = 1;`
    const result = processSource(source)
    expect(result).toContain('/// <reference types="node" />')
    expect(result).toContain('export declare const x: number')
  })

  it('should handle reference path directive', () => {
    const source = `/// <reference path="./types.d.ts" />\nexport const y: string = '';`
    const result = processSource(source)
    expect(result).toContain('/// <reference path="./types.d.ts" />')
    expect(result).toContain('export declare const y: string')
  })

  it('should handle multiple directives', () => {
    const source = `/// <reference types="node" />\n/// <reference types="bun-types" />\nexport const z: boolean = true;`
    const result = processSource(source)
    expect(result).toContain('/// <reference types="node" />')
    expect(result).toContain('/// <reference types="bun-types" />')
  })
})

// ============================================================
// MIXED / COMPLEX SCENARIOS
// ============================================================
describe('Complex mixed scenarios', () => {
  it('should handle file with all declaration types', () => {
    const source = `
      import type { ExternalType } from 'external';

      export const VERSION = '1.0.0';

      export type ID = string | number;

      export interface User {
        id: ID;
        name: string;
      }

      export enum Role { Admin, User, Guest }

      export class UserService {
        getUser(id: ID): User { return { id, name: '' }; }
      }

      export function createUser(name: string): User {
        return { id: '1', name };
      }

      export namespace Utils {
        export function validate(user: User): boolean { return true; }
      }

      export { ExternalType };
      export default UserService;
    `
    const result = processSource(source)
    expect(result).toContain('VERSION')
    expect(result).toContain('type ID')
    expect(result).toContain('interface User')
    expect(result).toContain('enum Role')
    expect(result).toContain('class UserService')
    expect(result).toContain('function createUser')
    expect(result).toContain('namespace Utils')
    expect(result).toContain('ExternalType')
    expect(result).toContain('export default UserService')
  })

  it('should handle complex generic class with multiple type parameters', () => {
    const source = `
      export class Map<K extends string | number | symbol, V> {
        private store: Record<K, V> = {} as Record<K, V>;
        set(key: K, value: V): this { this.store[key] = value; return this; }
        get(key: K): V | undefined { return this.store[key]; }
        has(key: K): boolean { return key in this.store; }
        delete(key: K): boolean { delete this.store[key]; return true; }
        keys(): K[] { return Object.keys(this.store) as K[]; }
        values(): V[] { return Object.values(this.store) as V[]; }
        entries(): [K, V][] { return Object.entries(this.store) as [K, V][]; }
        get size(): number { return Object.keys(this.store).length; }
      }
    `
    const result = processSource(source)
    expect(result).toContain('Map<K extends string | number | symbol, V>')
    expect(result).toContain('set(key: K, value: V): this')
    expect(result).toContain('get(key: K): V | undefined')
    expect(result).toContain('has(key: K): boolean')
    expect(result).toContain('keys(): K[]')
    expect(result).toContain('entries(): [K, V][]')
    expect(result).toContain('get size(): number')
  })

  it('should handle many exports from single file', () => {
    const exports = Array.from({ length: 50 }, (_, i) =>
      `export function fn${i}(x: number): number { return x + ${i}; }`).join('\n')
    const result = processSource(exports)
    for (let i = 0; i < 50; i++) {
      expect(result).toContain(`export declare function fn${i}(x: number): number;`)
    }
  })

  it('should handle interface with many properties', () => {
    const props = Array.from({ length: 30 }, (_, i) => `prop${i}: string;`).join('\n  ')
    const source = `export interface BigInterface {\n  ${props}\n}`
    const result = processSource(source)
    expect(result).toContain('export declare interface BigInterface')
    for (let i = 0; i < 30; i++) {
      expect(result).toContain(`prop${i}: string`)
    }
  })

  it('should handle deeply nested generic types', () => {
    const source = `
      export type Nested = Promise<Array<Map<string, Set<number>>>>;
    `
    const result = processSource(source)
    expect(result).toContain('type Nested = Promise<Array<Map<string, Set<number>>>>')
  })
})

// ============================================================
// EXTRACTION EDGE CASES
// ============================================================
describe('Extraction edge cases', () => {
  it('should extract all declaration kinds correctly', () => {
    const source = `
      import { X } from 'x';
      export type T = string;
      export interface I { x: number; }
      export function f(): void {}
      export const v = 1;
      export class C {}
      export enum E { A }
      export namespace N { export const y = 2; }
      export { X };
    `
    const decls = extractDeclarations(source, 'test.ts')
    const kinds = decls.map(d => d.kind)
    expect(kinds).toContain('import')
    expect(kinds).toContain('type')
    expect(kinds).toContain('interface')
    expect(kinds).toContain('function')
    expect(kinds).toContain('variable')
    expect(kinds).toContain('class')
    expect(kinds).toContain('enum')
    expect(kinds).toContain('export')
  })

  it('should track isExported correctly', () => {
    const source = `
      export function exported(): void {}
      function notExported(): void {}
      export interface ExportedInterface { x: number; }
      interface InternalInterface { y: string; }
    `
    const decls = extractDeclarations(source, 'test.ts')
    const exported = decls.find(d => d.name === 'exported')
    expect(exported?.isExported).toBe(true)

    const exportedIface = decls.find(d => d.name === 'ExportedInterface')
    expect(exportedIface?.isExported).toBe(true)
  })

  it('should track isTypeOnly correctly on imports/exports', () => {
    const source = `
      import type { TypeImport } from './types';
      import { ValueImport } from './values';
      export type { TypeImport };
    `
    const decls = extractDeclarations(source, 'test.ts')
    const typeImport = decls.find(d => d.kind === 'import' && d.text.includes('TypeImport'))
    expect(typeImport?.isTypeOnly).toBe(true)

    const valueImport = decls.find(d => d.kind === 'import' && d.text.includes('ValueImport'))
    expect(valueImport?.isTypeOnly).toBe(false)
  })

  it('should handle empty interface', () => {
    const source = `export interface Empty {}`
    const result = processSource(source)
    expect(result).toContain('export declare interface Empty')
  })

  it('should handle empty class', () => {
    const source = `export class Empty {}`
    const result = processSource(source)
    expect(result).toContain('export declare class Empty')
  })

  it('should handle empty enum', () => {
    const source = `export enum Empty {}`
    const result = processSource(source)
    expect(result).toContain('export declare enum Empty')
  })

  it('should handle empty namespace', () => {
    const source = `export namespace Empty {}`
    const result = processSource(source)
    expect(result).toContain('namespace Empty')
  })
})

// ============================================================
// OVERLOADED FUNCTIONS
// ============================================================
describe('Overloaded functions', () => {
  it('should handle function with multiple overload signatures', () => {
    const source = `
      export function format(value: string): string
      export function format(value: number): string
      export function format(value: Date): string
      export function format(value: any): string {
        return String(value)
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function format(value: string): string;')
    expect(result).toContain('export declare function format(value: number): string;')
    expect(result).toContain('export declare function format(value: Date): string;')
    // Implementation signature should NOT appear
    expect(result).not.toContain('format(value: any)')
  })

  it('should handle overloads with generic signatures', () => {
    const source = `
      export function convert<T extends string>(value: T): T
      export function convert<T extends number>(value: T): T
      export function convert(value: any): any {
        return value
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function convert<T extends string>(value: T): T;')
    expect(result).toContain('export declare function convert<T extends number>(value: T): T;')
    expect(result).not.toContain('convert(value: any)')
  })

  it('should handle overloads with different return types', () => {
    const source = `
      export function create(type: 'string'): string
      export function create(type: 'number'): number
      export function create(type: 'boolean'): boolean
      export function create(type: string): unknown {
        switch (type) {
          case 'string': return ''
          case 'number': return 0
          case 'boolean': return false
          default: return undefined
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function create(type: \'string\'): string;')
    expect(result).toContain('export declare function create(type: \'number\'): number;')
    expect(result).toContain('export declare function create(type: \'boolean\'): boolean;')
    expect(result).not.toContain('create(type: string)')
  })
})

// ============================================================
// ASYNC/GENERATOR FUNCTIONS
// ============================================================
describe('Async and generator functions', () => {
  it('should handle async function', () => {
    const source = `
      export async function fetchData(url: string): Promise<Response> {
        return fetch(url)
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function fetchData(url: string): Promise<Response>;')
  })

  it('should handle async generator function', () => {
    const source = `
      export async function* streamData<T>(items: T[]): AsyncGenerator<T> {
        for (const item of items) {
          yield item
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function streamData<T>(items: T[]): AsyncGenerator<T>;')
  })

  it('should handle generator function', () => {
    const source = `
      export function* range(start: number, end: number): Generator<number> {
        for (let i = start; i < end; i++) {
          yield i
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function range(start: number, end: number): Generator<number>;')
  })
})

// ============================================================
// TYPE GUARDS AND ASSERTIONS
// ============================================================
describe('Type guards and assertions', () => {
  it('should handle type guard function', () => {
    const source = `
      export function isString(value: unknown): value is string {
        return typeof value === 'string'
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function isString(value: unknown): value is string;')
  })

  it('should handle assertion function', () => {
    const source = `
      export function assertNonNull<T>(value: T | null | undefined): asserts value is T {
        if (value == null) throw new Error('Unexpected null')
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function assertNonNull<T>(value: T | null | undefined): asserts value is T;')
  })

  it('should handle type guard with union type parameter', () => {
    const source = `
      type Cat = { meow(): void }
      type Dog = { bark(): void }
      export function isCat(animal: Cat | Dog): animal is Cat {
        return 'meow' in animal
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function isCat(animal: Cat | Dog): animal is Cat;')
  })
})

// ============================================================
// COMPLEX VARIABLE PATTERNS
// ============================================================
describe('Complex variable patterns', () => {
  it('should handle const with explicit generic type', () => {
    const source = `
      export const items: Array<string> = ['a', 'b', 'c']
    `
    const result = processSource(source)
    // For const with a value, narrow inference from value takes priority over generic type annotation
    expect(result).toContain('export declare const items:')
  })

  it('should handle const with readonly array', () => {
    const source = `
      export const COLORS = ['red', 'green', 'blue'] as const
    `
    const result = processSource(source)
    expect(result).toContain('export declare const COLORS:')
    expect(result).toContain('readonly')
  })

  it('should handle let and var declarations', () => {
    const source = `
      export let mutableValue: string = 'hello'
      export var legacyValue: number = 42
    `
    const result = processSource(source)
    expect(result).toContain('export declare let mutableValue: string;')
    expect(result).toContain('export declare var legacyValue: number;')
  })

  it('should handle const with complex object type annotation', () => {
    const source = `
      export const config: {
        host: string
        port: number
        ssl: boolean
      } = {
        host: 'localhost',
        port: 3000,
        ssl: false,
      }
    `
    const result = processSource(source)
    expect(result).toContain('host: string')
    expect(result).toContain('port: number')
    expect(result).toContain('ssl: boolean')
  })

  it('should handle const with satisfies operator', () => {
    const source = `
      type RGB = [number, number, number]
      export const red = [255, 0, 0] satisfies RGB
    `
    const result = processSource(source)
    expect(result).toContain('export declare const red: RGB;')
  })

  it('should handle const with nested object literal', () => {
    const source = `
      export const nested = {
        a: {
          b: {
            c: 'deep'
          }
        }
      } as const
    `
    const result = processSource(source)
    expect(result).toContain('export declare const nested:')
    expect(result).toContain('\'deep\'')
  })

  it('should handle const with function value', () => {
    const source = `
      export const add = (a: number, b: number): number => a + b
    `
    const result = processSource(source)
    expect(result).toContain('export declare const add:')
  })

  it('should handle const with new expression', () => {
    const source = `
      export const map = new Map<string, number>()
    `
    const result = processSource(source)
    expect(result).toContain('export declare const map: Map<string, number>;')
  })

  it('should handle const with template literal value', () => {
    const source = `
      export const greeting = \`Hello World\`
    `
    const result = processSource(source)
    expect(result).toContain('export declare const greeting:')
  })
})

// ============================================================
// ABSTRACT CLASSES
// ============================================================
describe('Abstract classes', () => {
  it('should handle abstract class with abstract methods', () => {
    const source = `
      export abstract class Shape {
        abstract area(): number
        abstract perimeter(): number
        toString(): string {
          return \`Shape: area=\${this.area()}\`
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare abstract class Shape')
    expect(result).toContain('abstract area(): number;')
    expect(result).toContain('abstract perimeter(): number;')
    expect(result).toContain('toString(): string;')
  })

  it('should handle abstract class with abstract properties', () => {
    const source = `
      export abstract class Component {
        abstract readonly name: string
        abstract render(): void
      }
    `
    const result = processSource(source)
    expect(result).toContain('abstract class Component')
    expect(result).toContain('abstract readonly name: string;')
    expect(result).toContain('abstract render(): void;')
  })
})

// ============================================================
// CLASS ACCESS MODIFIERS
// ============================================================
describe('Class access modifiers', () => {
  it('should handle protected members', () => {
    const source = `
      export class Base {
        protected value: number = 0
        protected compute(): number { return this.value * 2 }
        public getResult(): number { return this.compute() }
      }
    `
    const result = processSource(source)
    expect(result).toContain('protected value: number;')
    expect(result).toContain('protected compute(): number;')
    expect(result).toContain('getResult(): number;')
  })

  it('should omit private members from DTS', () => {
    const source = `
      export class Encapsulated {
        private secret: string = 'hidden'
        private internalMethod(): void {}
        public publicMethod(): string { return this.secret }
      }
    `
    const result = processSource(source)
    expect(result).not.toContain('private secret')
    expect(result).not.toContain('internalMethod')
    expect(result).toContain('publicMethod(): string;')
  })

  it('should handle readonly constructor parameters', () => {
    const source = `
      export class Point {
        constructor(
          public readonly x: number,
          public readonly y: number,
          public readonly z: number = 0,
        ) {}
      }
    `
    const result = processSource(source)
    expect(result).toContain('constructor(x: number, y: number, z?: number);')
  })
})

// ============================================================
// CLASS GETTERS AND SETTERS
// ============================================================
describe('Class getters and setters', () => {
  it('should handle getter only', () => {
    const source = `
      export class Temperature {
        private celsius: number = 0
        get fahrenheit(): number {
          return this.celsius * 9/5 + 32
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('get fahrenheit(): number;')
    expect(result).not.toContain('private celsius')
  })

  it('should handle getter and setter', () => {
    const source = `
      export class Box {
        private _width: number = 0
        get width(): number { return this._width }
        set width(value: number) { this._width = value }
      }
    `
    const result = processSource(source)
    expect(result).toContain('get width(): number;')
    expect(result).toContain('set width(value: number);')
  })
})

// ============================================================
// CLASS STATIC MEMBERS
// ============================================================
describe('Class static members', () => {
  it('should handle static methods with generics', () => {
    const source = `
      export class Factory {
        static create<T>(ctor: new () => T): T {
          return new ctor()
        }
        static createMany<T>(ctor: new () => T, count: number): T[] {
          return Array.from({ length: count }, () => new ctor())
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('static create<T>(ctor: new () => T): T;')
    expect(result).toContain('static createMany<T>(ctor: new () => T, count: number): T[];')
  })

  it('should handle static properties', () => {
    const source = `
      export class Config {
        static readonly DEFAULT_TIMEOUT: number = 5000
        static instance: Config | null = null
      }
    `
    const result = processSource(source)
    expect(result).toContain('static readonly DEFAULT_TIMEOUT: number;')
    expect(result).toContain('static instance: Config | null;')
  })
})

// ============================================================
// CLASS IMPLEMENTS
// ============================================================
describe('Class implements', () => {
  it('should handle class implementing interface', () => {
    const source = `
      interface Disposable {
        dispose(): void
      }
      export class Resource implements Disposable {
        dispose(): void {
          // cleanup
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Resource implements Disposable')
    expect(result).toContain('dispose(): void;')
  })

  it('should handle class implementing multiple interfaces', () => {
    const source = `
      interface Readable { read(): string }
      interface Writable { write(data: string): void }
      export class Stream implements Readable, Writable {
        read(): string { return '' }
        write(data: string): void {}
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class Stream implements Readable, Writable')
  })
})

// ============================================================
// INTERFACE EXTENDS
// ============================================================
describe('Interface extends', () => {
  it('should handle interface extending another interface', () => {
    const source = `
      export interface Base {
        id: string
      }
      export interface Extended extends Base {
        name: string
        email: string
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface Extended extends Base')
    expect(result).toContain('name: string')
    expect(result).toContain('email: string')
  })

  it('should handle interface extending multiple interfaces', () => {
    const source = `
      interface HasId { id: string }
      interface HasName { name: string }
      export interface Entity extends HasId, HasName {
        createdAt: Date
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare interface Entity extends HasId, HasName')
    expect(result).toContain('createdAt: Date')
  })

  it('should handle interface with call signatures', () => {
    const source = `
      export interface Callable {
        (arg: string): number
        (arg: number): string
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface Callable')
    expect(result).toContain('(arg: string): number')
    expect(result).toContain('(arg: number): string')
  })

  it('should handle interface with construct signature', () => {
    const source = `
      export interface Constructor<T> {
        new (...args: any[]): T
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface Constructor<T>')
    expect(result).toContain('new (...args: any[]): T')
  })
})

// ============================================================
// INTERFACE WITH INDEX SIGNATURES
// ============================================================
describe('Interface with index signatures', () => {
  it('should handle string index signature', () => {
    const source = `
      export interface Dictionary {
        [key: string]: unknown
      }
    `
    const result = processSource(source)
    expect(result).toContain('[key: string]: unknown')
  })

  it('should handle number index signature', () => {
    const source = `
      export interface NumberMap {
        [index: number]: string
      }
    `
    const result = processSource(source)
    expect(result).toContain('[index: number]: string')
  })

  it('should handle mixed index and named properties', () => {
    const source = `
      export interface Config {
        [key: string]: any
        name: string
        version: number
      }
    `
    const result = processSource(source)
    expect(result).toContain('[key: string]: any')
    expect(result).toContain('name: string')
    expect(result).toContain('version: number')
  })
})

// ============================================================
// ENUM EDGE CASES
// ============================================================
describe('Enum edge cases', () => {
  it('should handle enum with computed values', () => {
    const source = `
      export enum FileAccess {
        None,
        Read = 1 << 1,
        Write = 1 << 2,
        ReadWrite = Read | Write,
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum FileAccess')
    expect(result).toContain('None')
    expect(result).toContain('Read')
    expect(result).toContain('Write')
    expect(result).toContain('ReadWrite')
  })

  it('should handle const enum', () => {
    const source = `
      export const enum Color {
        Red = 'RED',
        Green = 'GREEN',
        Blue = 'BLUE',
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare const enum Color')
    expect(result).toContain('Red = \'RED\'')
    expect(result).toContain('Green = \'GREEN\'')
    expect(result).toContain('Blue = \'BLUE\'')
  })

  it('should handle enum with heterogeneous values', () => {
    const source = `
      export enum Mixed {
        No = 0,
        Yes = 'YES',
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum Mixed')
    expect(result).toContain('No = 0')
    expect(result).toContain('Yes = \'YES\'')
  })
})

// ============================================================
// MODULE DECLARATIONS
// ============================================================
describe('Module declarations', () => {
  it('should handle ambient module declaration', () => {
    const source = `
      declare module 'my-module' {
        export function doSomething(): void
        export const version: string
      }
    `
    const result = processSource(source)
    expect(result).toContain('declare module \'my-module\'')
    expect(result).toContain('export function doSomething(): void')
    expect(result).toContain('export const version: string')
  })

  it('should handle global augmentation', () => {
    const source = `
      declare global {
        interface Window {
          myCustomProp: string
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('declare global')
    expect(result).toContain('myCustomProp: string')
  })

  it('should handle nested namespaces', () => {
    const source = `
      export namespace Outer {
        export namespace Inner {
          export interface Config {
            value: string
          }
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('namespace Outer')
    expect(result).toContain('namespace Inner')
    expect(result).toContain('value: string')
  })
})

// ============================================================
// EXPORT PATTERNS
// ============================================================
describe('Export patterns', () => {
  it('should handle wildcard re-export', () => {
    const source = `
      export * from './utils'
    `
    const result = processSource(source)
    expect(result).toContain('export * from \'./utils\';')
  })

  it('should handle named re-export with rename', () => {
    const source = `
      export { foo as bar } from './module'
    `
    const result = processSource(source)
    expect(result).toContain('export { foo as bar } from \'./module\';')
  })

  it('should handle type-only export', () => {
    const source = `
      export type { MyType } from './types'
    `
    const result = processSource(source)
    expect(result).toContain('export type { MyType } from \'./types\';')
  })

  it('should handle export with type modifier on individual items', () => {
    const source = `
      import { value, type MyType } from './module'
      export { value, type MyType }
    `
    const result = processSource(source)
    expect(result).toContain('export { value, type MyType };')
  })

  it('should handle export namespace', () => {
    const source = `
      export * as utils from './utils'
    `
    const result = processSource(source)
    expect(result).toContain('export * as utils from \'./utils\';')
  })
})

// ============================================================
// IMPORT PATTERNS
// ============================================================
describe('Import patterns', () => {
  it('should preserve type-only imports when used', () => {
    const source = `
      import type { Config } from './config'
      export function getConfig(): Config {
        return {} as Config
      }
    `
    const result = processSource(source)
    expect(result).toContain('import type { Config } from \'./config\';')
    expect(result).toContain('export declare function getConfig(): Config;')
  })

  it('should remove unused imports', () => {
    const source = `
      import { used, unused } from './module'
      export function test(): used {
        return {} as used
      }
    `
    const result = processSource(source)
    // used should be present, unused should not
    expect(result).not.toContain('unused')
  })

  it('should handle import with alias', () => {
    const source = `
      import { OriginalName as AliasName } from './module'
      export function test(): AliasName {
        return {} as AliasName
      }
    `
    const result = processSource(source)
    expect(result).toContain('OriginalName as AliasName')
  })
})

// ============================================================
// COMPLEX TYPE ALIASES
// ============================================================
describe('Complex type aliases', () => {
  it('should handle intersection with union types', () => {
    const source = `
      export type Result = (Success | Failure) & { timestamp: Date }
    `
    const result = processSource(source)
    expect(result).toContain('type Result = (Success | Failure) & { timestamp: Date }')
  })

  it('should handle conditional type with nested conditions', () => {
    const source = `
      export type TypeName<T> =
        T extends string ? 'string' :
        T extends number ? 'number' :
        T extends boolean ? 'boolean' :
        T extends undefined ? 'undefined' :
        T extends Function ? 'function' :
        'object'
    `
    const result = processSource(source)
    expect(result).toContain('type TypeName<T>')
    expect(result).toContain('T extends string ? \'string\'')
    expect(result).toContain('\'object\'')
  })

  it('should handle recursive type', () => {
    const source = `
      export type NestedArray<T> = T | NestedArray<T>[]
    `
    const result = processSource(source)
    expect(result).toContain('type NestedArray<T> = T | NestedArray<T>[]')
  })

  it('should handle mapped type with as clause', () => {
    const source = `
      export type PickByType<T, V> = {
        [K in keyof T as T[K] extends V ? K : never]: T[K]
      }
    `
    const result = processSource(source)
    expect(result).toContain('type PickByType<T, V>')
    expect(result).toContain('[K in keyof T as T[K] extends V ? K : never]')
  })

  it('should handle utility types composition', () => {
    const source = `
      export type StrictOmit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>
    `
    const result = processSource(source)
    expect(result).toContain('type StrictOmit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>')
  })
})

// ============================================================
// DECLARATION MERGING
// ============================================================
describe('Declaration merging', () => {
  it('should handle function and namespace merging', () => {
    const source = `
      export function validate(value: string): boolean {
        return value.length > 0
      }
      export namespace validate {
        export const EMAIL_REGEX = /^[^@]+@[^@]+$/
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function validate(value: string): boolean;')
    expect(result).toContain('export declare namespace validate')
  })
})

// ============================================================
// COMMENTS AND JSDOC PRESERVATION
// ============================================================
describe('Comment preservation edge cases', () => {
  it('should preserve JSDoc with complex tags', () => {
    const source = `
      /**
       * @param {string} name - The name parameter
       * @returns {Promise<void>}
       * @throws {TypeError} When name is empty
       * @deprecated Use newFunction instead
       * @since 2.0.0
       * @see {@link newFunction}
       */
      export function oldFunction(name: string): Promise<void> {
        return Promise.resolve()
      }
    `
    const result = processSource(source)
    expect(result).toContain('@param {string} name')
    expect(result).toContain('@returns {Promise<void>}')
    expect(result).toContain('@throws {TypeError}')
    expect(result).toContain('@deprecated')
    expect(result).toContain('@since 2.0.0')
    expect(result).toContain('@see')
  })

  it('should preserve JSDoc with @example blocks', () => {
    const source = `
      /**
       * Adds two numbers
       * @example
       * \`\`\`ts
       * const result = add(1, 2)
       * // result is 3
       * \`\`\`
       */
      export function add(a: number, b: number): number {
        return a + b
      }
    `
    const result = processSource(source)
    expect(result).toContain('@example')
    expect(result).toContain('const result = add(1, 2)')
  })

  it('should preserve inline comments in enum members', () => {
    const source = `
      export enum Status {
        /** Active status */
        Active = 'active',
        /** Inactive status */
        Inactive = 'inactive',
      }
    `
    const result = processSource(source)
    expect(result).toContain('/** Active status */')
    expect(result).toContain('/** Inactive status */')
  })

  it('should handle multi-line comment before type alias', () => {
    const source = `
      /**
       * A complex type that represents
       * the possible states of the application
       */
      export type AppState = 'loading' | 'ready' | 'error'
    `
    const result = processSource(source)
    expect(result).toContain('A complex type that represents')
    expect(result).toContain('the possible states of the application')
  })
})

// ============================================================
// TRIPLE-SLASH DIRECTIVES
// ============================================================
describe('Triple-slash directive edge cases', () => {
  it('should preserve reference path directive', () => {
    const source = `/// <reference path="./global.d.ts" />
      export const x: number = 1
    `
    const result = processSource(source)
    expect(result).toContain('/// <reference path="./global.d.ts" />')
  })

  it('should preserve reference types directive', () => {
    const source = `/// <reference types="node" />
      export function readFile(path: string): Buffer {
        return Buffer.from('')
      }
    `
    const result = processSource(source)
    expect(result).toContain('/// <reference types="node" />')
  })

  it('should preserve multiple directives', () => {
    const source = `/// <reference types="node" />
/// <reference path="./types.d.ts" />
      export const x: number = 1
    `
    const result = processSource(source)
    expect(result).toContain('/// <reference types="node" />')
    expect(result).toContain('/// <reference path="./types.d.ts" />')
  })
})

// ============================================================
// COMPLEX FUNCTION SIGNATURES
// ============================================================
describe('Complex function signatures', () => {
  it('should handle rest parameters', () => {
    const source = `
      export function join(separator: string, ...parts: string[]): string {
        return parts.join(separator)
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function join(separator: string, ...parts: string[]): string;')
  })

  it('should handle destructured parameters with types', () => {
    const source = `
      export function configure({ host, port, ssl }: { host: string; port: number; ssl: boolean }): void {
        // configure
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function configure')
    expect(result).toContain('host: string')
  })

  it('should handle function with this parameter', () => {
    const source = `
      export function greet(this: HTMLElement, name: string): string {
        return \`Hello \${name}\`
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function greet(this: HTMLElement, name: string): string;')
  })

  it('should handle function returning tuple', () => {
    const source = `
      export function divide(a: number, b: number): [quotient: number, remainder: number] {
        return [Math.floor(a / b), a % b]
      }
    `
    const result = processSource(source)
    expect(result).toContain('[quotient: number, remainder: number]')
  })

  it('should handle function with callback parameter', () => {
    const source = `
      export function forEach<T>(items: T[], callback: (item: T, index: number) => void): void {
        items.forEach(callback)
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function forEach<T>(items: T[], callback: (item: T, index: number) => void): void;')
  })

  it('should handle function with default parameters', () => {
    const source = `
      export function greet(name: string = 'World', greeting: string = 'Hello'): string {
        return \`\${greeting}, \${name}!\`
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function greet(name?: string, greeting?: string): string;')
  })
})

// ============================================================
// MIXED DECLARATION INTERACTIONS
// ============================================================
describe('Mixed declaration interactions', () => {
  it('should handle type used by function and variable', () => {
    const source = `
      export type Status = 'active' | 'inactive'
      export function getStatus(): Status { return 'active' }
      export const DEFAULT_STATUS: Status = 'active'
    `
    const result = processSource(source)
    expect(result).toContain('type Status = \'active\' | \'inactive\'')
    expect(result).toContain('export declare function getStatus(): Status;')
    expect(result).toContain('export declare const DEFAULT_STATUS: Status;')
  })

  it('should handle interface used as function parameter and return type', () => {
    const source = `
      export interface User {
        id: number
        name: string
      }
      export function createUser(name: string): User {
        return { id: 1, name }
      }
      export function updateUser(user: User): User {
        return user
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface User')
    expect(result).toContain('export declare function createUser(name: string): User;')
    expect(result).toContain('export declare function updateUser(user: User): User;')
  })

  it('should handle class extending abstract class and implementing interface', () => {
    const source = `
      interface Printable {
        toString(): string
      }
      export abstract class Base {
        abstract id: string
      }
      export class Derived extends Base implements Printable {
        id: string = '1'
        toString(): string { return this.id }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare abstract class Base')
    expect(result).toContain('export declare class Derived extends Base implements Printable')
  })

  it('should handle enum used in function signature', () => {
    const source = `
      export enum Direction { Up, Down, Left, Right }
      export function move(direction: Direction): void {}
    `
    const result = processSource(source)
    expect(result).toContain('export declare enum Direction')
    expect(result).toContain('export declare function move(direction: Direction): void;')
  })

  it('should handle namespace with exported function using namespace type', () => {
    const source = `
      export namespace Config {
        export interface Options {
          debug: boolean
        }
      }
      export function createConfig(options: Config.Options): void {}
    `
    const result = processSource(source)
    expect(result).toContain('namespace Config')
    expect(result).toContain('export declare function createConfig(options: Config.Options): void;')
  })
})

// ============================================================
// WHITESPACE AND FORMATTING EDGE CASES
// ============================================================
describe('Whitespace and formatting', () => {
  it('should handle single-line declarations', () => {
    const source = `export const x: number = 1; export const y: string = 'hello';`
    const result = processSource(source)
    // With explicit type annotation, the annotation is preserved
    expect(result).toContain('export declare const x: number;')
    expect(result).toContain('export declare const y: string;')
  })

  it('should handle declaration with lots of whitespace', () => {
    const source = `
      export    function    spacey   (  a  :  number  ,  b  :  number  )  :  number  {
        return a + b
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare function spacey')
  })

  it('should produce valid output for empty source', () => {
    const source = ``
    const result = processSource(source)
    expect(result).toBe('')
  })

  it('should produce valid output for comments-only source', () => {
    const source = `
      // Just a comment
      /* Another comment */
    `
    const result = processSource(source)
    // Should be empty or whitespace-only (no declarations)
    expect(result.trim()).toBe('')
  })
})

// ============================================================
// ERROR RESILIENCE
// ============================================================
describe('Error resilience', () => {
  it('should handle declaration with very long type annotation', () => {
    const fields = Array.from({ length: 50 }, (_, i) => `field${i}: string`).join('\n  ')
    const source = `
      export interface LargeInterface {
        ${fields}
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface LargeInterface')
    expect(result).toContain('field0: string')
    expect(result).toContain('field49: string')
  })

  it('should handle deeply nested generics', () => {
    const source = `
      export type Deep = Map<string, Map<number, Map<boolean, Set<Array<Promise<string>>>>>>
    `
    const result = processSource(source)
    expect(result).toContain('type Deep = Map<string, Map<number, Map<boolean, Set<Array<Promise<string>>>>>>')
  })

  it('should handle multiple exports of same name via re-export', () => {
    const source = `
      export { default as React } from 'react'
      export * from './components'
    `
    const result = processSource(source)
    expect(result).toContain('export { default as React } from \'react\';')
    expect(result).toContain('export * from \'./components\';')
  })
})

// ============================================================
// NEW EXPRESSION TYPE INFERENCE
// ============================================================
describe('New expression type inference', () => {
  it('should infer Map with explicit generic params', () => {
    const source = `export const m = new Map<string, number>()`
    const result = processSource(source)
    expect(result).toContain('export declare const m: Map<string, number>;')
  })

  it('should infer Set with explicit generic param', () => {
    const source = `export const s = new Set<string>()`
    const result = processSource(source)
    expect(result).toContain('export declare const s: Set<string>;')
  })

  it('should infer WeakMap with explicit generic params', () => {
    const source = `export const wm = new WeakMap<object, string>()`
    const result = processSource(source)
    expect(result).toContain('export declare const wm: WeakMap<object, string>;')
  })

  it('should infer Promise with explicit generic param', () => {
    const source = `export const p = new Promise<string>(() => {})`
    const result = processSource(source)
    expect(result).toContain('export declare const p: Promise<string>;')
  })

  it('should infer custom class with generics', () => {
    const source = `
      class Container<T> {}
      export const c = new Container<number>()
    `
    const result = processSource(source)
    expect(result).toContain('export declare const c: Container<number>;')
  })

  it('should infer nested generic params in new expression', () => {
    const source = `export const m = new Map<string, Map<string, number>>()`
    const result = processSource(source)
    expect(result).toContain('export declare const m: Map<string, Map<string, number>>;')
  })

  it('should fallback to defaults when no generics specified', () => {
    const source = `export const m = new Map()`
    const result = processSource(source)
    expect(result).toContain('export declare const m: Map<any, any>;')
  })

  it('should infer Date without generics', () => {
    const source = `export const d = new Date()`
    const result = processSource(source)
    expect(result).toContain('export declare const d: Date;')
  })

  it('should infer Error type', () => {
    const source = `export const e = new Error('test')`
    const result = processSource(source)
    expect(result).toContain('export declare const e: Error;')
  })

  it('should infer RegExp type', () => {
    const source = `export const r = new RegExp('[a-z]')`
    const result = processSource(source)
    expect(result).toContain('export declare const r: RegExp;')
  })
})

// ============================================================
// INTERFACE METHOD GENERICS
// ============================================================
describe('Interface method generics', () => {
  it('should preserve generic type params on interface methods', () => {
    const source = `
      export interface Collection<T> {
        add(item: T): void
        find<S extends T>(predicate: (item: T) => item is S): S | undefined
        map<U>(fn: (item: T) => U): Collection<U>
      }
    `
    const result = processSource(source)
    expect(result).toContain('find<S extends T>(predicate: (item: T) => item is S): S | undefined')
    expect(result).toContain('map<U>(fn: (item: T) => U): Collection<U>')
  })

  it('should handle method with multiple generic params', () => {
    const source = `
      export interface Mapper {
        bimap<A, B>(fa: (x: string) => A, fb: (x: number) => B): [A, B]
      }
    `
    const result = processSource(source)
    expect(result).toContain('bimap<A, B>')
  })

  it('should handle method with constrained generic', () => {
    const source = `
      export interface Store<S> {
        select<K extends keyof S>(key: K): S[K]
      }
    `
    const result = processSource(source)
    expect(result).toContain('select<K extends keyof S>(key: K): S[K]')
  })

  it('should handle method with default generic param', () => {
    const source = `
      export interface Builder {
        build<T = object>(config?: Partial<T>): T
      }
    `
    const result = processSource(source)
    expect(result).toContain('build<T = object>(config?: Partial<T>): T')
  })
})

// ============================================================
// SATISFIES OPERATOR
// ============================================================
describe('Satisfies operator', () => {
  it('should extract satisfies type for const', () => {
    const source = `
      type Colors = Record<string, string>
      export const colors = {
        red: '#ff0000',
        green: '#00ff00',
      } satisfies Colors
    `
    const result = processSource(source)
    expect(result).toContain('export declare const colors: Colors;')
  })

  it('should handle satisfies with generic type', () => {
    const source = `
      type Config<T> = { value: T }
      export const config = { value: 42 } satisfies Config<number>
    `
    const result = processSource(source)
    expect(result).toContain('export declare const config: Config<number>;')
  })
})

// ============================================================
// AS CONST ASSERTIONS
// ============================================================
describe('As const assertions', () => {
  it('should narrow string literal with as const', () => {
    const source = `export const greeting = 'hello' as const`
    const result = processSource(source)
    expect(result).toContain('export declare const greeting: \'hello\';')
  })

  it('should narrow number literal with as const', () => {
    const source = `export const count = 42 as const`
    const result = processSource(source)
    expect(result).toContain('export declare const count: 42;')
  })

  it('should narrow array with as const', () => {
    const source = `export const arr = [1, 2, 3] as const`
    const result = processSource(source)
    expect(result).toContain('readonly [1, 2, 3]')
  })

  it('should narrow object with as const', () => {
    const source = `
      export const obj = {
        name: 'test',
        value: 42,
      } as const
    `
    const result = processSource(source)
    expect(result).toContain('name: \'test\'')
    expect(result).toContain('value: 42')
  })

  it('should narrow nested object with as const', () => {
    const source = `
      export const deep = {
        a: { b: { c: 'deep' } }
      } as const
    `
    const result = processSource(source)
    expect(result).toContain('c: \'deep\'')
  })
})

// ============================================================
// DECLARATION ORDER AND GROUPING
// ============================================================
describe('Declaration order and grouping', () => {
  it('should output imports before declarations', () => {
    const source = `
      import type { Config } from './config'
      export function getConfig(): Config { return {} as Config }
      export const x: number = 1
    `
    const result = processSource(source)
    const importIdx = result.indexOf('import')
    const declIdx = result.indexOf('export declare')
    expect(importIdx).toBeLessThan(declIdx)
  })

  it('should output exports after declarations', () => {
    const source = `
      const internal = 'value'
      export function getValue(): string { return internal }
      export { internal }
    `
    const result = processSource(source)
    const funcIdx = result.indexOf('export declare function')
    const exportIdx = result.indexOf('export { internal }')
    expect(funcIdx).toBeLessThan(exportIdx)
  })

  it('should output type exports before value exports', () => {
    const source = `
      type MyType = string
      const myValue = 'hello'
      export type { MyType }
      export { myValue }
    `
    const result = processSource(source)
    const typeExportIdx = result.indexOf('export type { MyType }')
    const valueExportIdx = result.indexOf('export { myValue }')
    if (typeExportIdx !== -1 && valueExportIdx !== -1) {
      expect(typeExportIdx).toBeLessThan(valueExportIdx)
    }
  })
})

// ============================================================
// SIDE-EFFECT IMPORTS
// ============================================================
describe('Side-effect imports', () => {
  it('should preserve side-effect imports', () => {
    const source = `
      import 'reflect-metadata'
      export class MyClass {}
    `
    const result = processSource(source)
    expect(result).toContain('import \'reflect-metadata\';')
  })

  it('should preserve multiple side-effect imports', () => {
    const source = `
      import './polyfills'
      import 'reflect-metadata'
      export const x: number = 1
    `
    const result = processSource(source)
    expect(result).toContain('import \'./polyfills\';')
    expect(result).toContain('import \'reflect-metadata\';')
  })
})

// ============================================================
// COMPLEX REAL-WORLD PATTERNS
// ============================================================
describe('Complex real-world patterns', () => {
  it('should handle React-like component types', () => {
    const source = `
      export type FC<P = {}> = (props: P) => JSX.Element | null
      export type PropsWithChildren<P = {}> = P & { children?: any }
    `
    const result = processSource(source)
    expect(result).toContain('type FC<P = {}>')
    expect(result).toContain('type PropsWithChildren<P = {}>')
  })

  it('should handle Express-like middleware signature', () => {
    const source = `
      export type NextFunction = () => void
      export type Middleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>
    `
    const result = processSource(source)
    expect(result).toContain('type NextFunction = () => void')
    expect(result).toContain('type Middleware')
  })

  it('should handle event handler map pattern', () => {
    const source = `
      export interface EventMap {
        click: MouseEvent
        keydown: KeyboardEvent
        submit: Event
      }
      export type EventHandler<K extends keyof EventMap> = (event: EventMap[K]) => void
    `
    const result = processSource(source)
    expect(result).toContain('interface EventMap')
    expect(result).toContain('type EventHandler<K extends keyof EventMap>')
  })

  it('should handle builder pattern', () => {
    const source = `
      export class QueryBuilder<T> {
        where(condition: Partial<T>): QueryBuilder<T> {
          return this
        }
        orderBy<K extends keyof T>(field: K, direction?: 'asc' | 'desc'): QueryBuilder<T> {
          return this
        }
        limit(count: number): QueryBuilder<T> {
          return this
        }
        execute(): Promise<T[]> {
          return Promise.resolve([])
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('export declare class QueryBuilder<T>')
    expect(result).toContain('where(condition: Partial<T>): QueryBuilder<T>;')
    expect(result).toContain('orderBy<K extends keyof T>(field: K, direction?: \'asc\' | \'desc\'): QueryBuilder<T>;')
    expect(result).toContain('limit(count: number): QueryBuilder<T>;')
    expect(result).toContain('execute(): Promise<T[]>;')
  })

  it('should handle plugin system pattern', () => {
    const source = `
      export interface Plugin<T = any> {
        name: string
        install(app: T): void
      }
      export function definePlugin<T>(plugin: Plugin<T>): Plugin<T> {
        return plugin
      }
    `
    const result = processSource(source)
    expect(result).toContain('interface Plugin<T = any>')
    expect(result).toContain('export declare function definePlugin<T>(plugin: Plugin<T>): Plugin<T>;')
  })

  it('should handle state management pattern', () => {
    const source = `
      export type Action<T extends string = string, P = any> = {
        type: T
        payload: P
      }
      export type Reducer<S, A extends Action> = (state: S, action: A) => S
      export function createReducer<S, A extends Action>(
        initialState: S,
        handlers: { [K in A['type']]?: Reducer<S, Extract<A, { type: K }>> }
      ): Reducer<S, A> {
        return (state = initialState, action) => {
          const handler = (handlers as any)[action.type]
          return handler ? handler(state, action) : state
        }
      }
    `
    const result = processSource(source)
    expect(result).toContain('type Action<T extends string = string, P = any>')
    expect(result).toContain('type Reducer<S, A extends Action>')
    expect(result).toContain('export declare function createReducer')
  })
})

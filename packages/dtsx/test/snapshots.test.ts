/**
 * Snapshot tests for complex type transformations
 *
 * These tests verify that the declaration generator produces
 * consistent, correct output for complex TypeScript patterns.
 */

import { describe, expect, test } from 'bun:test'
import { normalize, processCode } from './test-utils'

function generateDeclarations(source: string, keepComments = false): string {
  return processCode(source, 'test.ts', keepComments)
}

describe('Snapshot Tests', () => {
  describe('Generic Types', () => {
    test('complex generic constraints', () => {
      const source = `
        export type KeysOfType<T, V> = {
          [K in keyof T]: T[K] extends V ? K : never
        }[keyof T];

        export type RequiredKeys<T> = {
          [K in keyof T]-?: {} extends Pick<T, K> ? never : K
        }[keyof T];

        export type OptionalKeys<T> = {
          [K in keyof T]-?: {} extends Pick<T, K> ? K : never
        }[keyof T];
      `

      const result = generateDeclarations(source)

      expect(result).toContain('KeysOfType')
      expect(result).toContain('RequiredKeys')
      expect(result).toContain('OptionalKeys')
      expect(result).toContain('[K in keyof T]')
    })

    test('recursive generic types', () => {
      const source = `
        export type DeepPartial<T> = T extends object
          ? { [P in keyof T]?: DeepPartial<T[P]> }
          : T;

        export type DeepReadonly<T> = T extends object
          ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
          : T;

        export type DeepRequired<T> = T extends object
          ? { [P in keyof T]-?: DeepRequired<T[P]> }
          : T;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('DeepPartial')
      expect(result).toContain('DeepReadonly')
      expect(result).toContain('DeepRequired')
      expect(result).toContain('T extends object')
    })

    test('generic with multiple constraints', () => {
      const source = `
        export function merge<
          T extends object,
          U extends object,
          V extends T & U = T & U
        >(a: T, b: U): V;

        export class Container<
          T extends string | number,
          K extends keyof any = string
        > {
          get(key: K): T | undefined;
          set(key: K, value: T): void;
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('T extends object')
      expect(result).toContain('U extends object')
      expect(result).toContain('V extends T & U')
      expect(result).toContain('T extends string | number')
    })
  })

  describe('Conditional Types', () => {
    test('nested conditional types', () => {
      const source = `
        export type UnwrapPromise<T> = T extends Promise<infer U>
          ? U extends Promise<infer V>
            ? UnwrapPromise<V>
            : U
          : T;

        export type Flatten<T> = T extends Array<infer U>
          ? Flatten<U>
          : T;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('UnwrapPromise')
      expect(result).toContain('Flatten')
      expect(result).toContain('Promise<infer U>')
      expect(result).toContain('Array<infer U>')
    })

    test('distributive conditional types', () => {
      const source = `
        export type NonNullable<T> = T extends null | undefined ? never : T;

        export type Extract<T, U> = T extends U ? T : never;

        export type Exclude<T, U> = T extends U ? never : T;

        export type ReturnType<T extends (...args: any) => any> =
          T extends (...args: any) => infer R ? R : any;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('NonNullable')
      expect(result).toContain('Extract')
      expect(result).toContain('Exclude')
      expect(result).toContain('ReturnType')
    })

    test('infer in conditional types', () => {
      const source = `
        export type Parameters<T extends (...args: any) => any> =
          T extends (...args: infer P) => any ? P : never;

        export type ConstructorParameters<T extends abstract new (...args: any) => any> =
          T extends abstract new (...args: infer P) => any ? P : never;

        export type InstanceType<T extends abstract new (...args: any) => any> =
          T extends abstract new (...args: any) => infer R ? R : any;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('Parameters')
      expect(result).toContain('ConstructorParameters')
      expect(result).toContain('InstanceType')
      expect(result).toContain('infer P')
      expect(result).toContain('infer R')
    })
  })

  describe('Mapped Types', () => {
    test('mapped type modifiers', () => {
      const source = `
        export type Readonly<T> = {
          readonly [P in keyof T]: T[P];
        };

        export type Mutable<T> = {
          -readonly [P in keyof T]: T[P];
        };

        export type Partial<T> = {
          [P in keyof T]?: T[P];
        };

        export type Required<T> = {
          [P in keyof T]-?: T[P];
        };
      `

      const result = generateDeclarations(source)

      expect(result).toContain('readonly [P in keyof T]')
      expect(result).toContain('-readonly [P in keyof T]')
      expect(result).toContain('[P in keyof T]?')
      expect(result).toContain('[P in keyof T]-?')
    })

    test('mapped types with key remapping', () => {
      const source = `
        export type Getters<T> = {
          [K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K]
        };

        export type Setters<T> = {
          [K in keyof T as \`set\${Capitalize<string & K>}\`]: (value: T[K]) => void
        };

        export type RemoveKindField<T> = {
          [K in keyof T as Exclude<K, "kind">]: T[K]
        };
      `

      const result = generateDeclarations(source)

      expect(result).toContain('Getters')
      expect(result).toContain('Setters')
      expect(result).toContain('RemoveKindField')
      expect(result).toContain('as `get${Capitalize<string & K>}`')
    })
  })

  describe('Template Literal Types', () => {
    test('basic template literal types', () => {
      const source = `
        export type EventName<T extends string> = \`on\${Capitalize<T>}\`;

        export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
        export type Endpoint = \`/api/\${string}\`;
        export type Route = \`\${HTTPMethod} \${Endpoint}\`;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('EventName')
      expect(result).toContain('HTTPMethod')
      expect(result).toContain('Endpoint')
      expect(result).toContain('Route')
    })

    test('complex template literal types', () => {
      const source = `
        export type PropEventSource<T> = {
          on<K extends string & keyof T>(
            eventName: \`\${K}Changed\`,
            callback: (newValue: T[K]) => void
          ): void;
        };

        export type CSSValue = \`\${number}px\` | \`\${number}em\` | \`\${number}%\`;

        export type Join<T extends string[], D extends string> =
          T extends [] ? '' :
          T extends [infer F] ? F :
          T extends [infer F, ...infer R] ?
            F extends string ?
              R extends string[] ?
                \`\${F}\${D}\${Join<R, D>}\`
              : never
            : never
          : string;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('PropEventSource')
      expect(result).toContain('CSSValue')
      expect(result).toContain('Join')
    })
  })

  describe('Function Overloads', () => {
    test('multiple function overloads', () => {
      const source = `
        export function createElement(tag: 'div'): HTMLDivElement;
        export function createElement(tag: 'span'): HTMLSpanElement;
        export function createElement(tag: 'input'): HTMLInputElement;
        export function createElement(tag: string): HTMLElement;
        export function createElement(tag: string): HTMLElement {
          return document.createElement(tag);
        }
      `

      const result = generateDeclarations(source)

      // Should have all overloads
      expect(result).toContain('createElement(tag: \'div\'): HTMLDivElement')
      expect(result).toContain('createElement(tag: \'span\'): HTMLSpanElement')
      expect(result).toContain('createElement(tag: \'input\'): HTMLInputElement')
      expect(result).toContain('createElement(tag: string): HTMLElement')
    })

    test('generic function overloads', () => {
      const source = `
        export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
        export function pick<T>(obj: T, keys: string[]): Partial<T>;
        export function pick(obj: any, keys: string[]): any {
          return keys.reduce((acc, key) => {
            if (key in obj) acc[key] = obj[key];
            return acc;
          }, {} as any);
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('pick<T, K extends keyof T>')
      expect(result).toContain('Pick<T, K>')
      expect(result).toContain('Partial<T>')
    })
  })

  describe('Class Patterns', () => {
    test('abstract class with generics', () => {
      const source = `
        export abstract class Repository<T, ID = string> {
          abstract findById(id: ID): Promise<T | null>;
          abstract findAll(): Promise<T[]>;
          abstract save(entity: T): Promise<T>;
          abstract delete(id: ID): Promise<boolean>;

          async findByIds(ids: ID[]): Promise<T[]> {
            const results = await Promise.all(ids.map(id => this.findById(id)));
            return results.filter((r): r is T => r !== null);
          }
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('abstract class Repository<T, ID = string>')
      expect(result).toContain('abstract findById(id: ID): Promise<T | null>')
      expect(result).toContain('abstract findAll(): Promise<T[]>')
      expect(result).toContain('findByIds(ids: ID[]): Promise<T[]>')
    })

    test('class with decorators pattern', () => {
      const source = `
        export class Controller {
          @Get('/users')
          getUsers(): User[];

          @Post('/users')
          createUser(@Body() user: CreateUserDto): User;

          @Put('/users/:id')
          updateUser(@Param('id') id: string, @Body() user: UpdateUserDto): User;
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('class Controller')
      expect(result).toContain('getUsers()')
      expect(result).toContain('createUser')
      expect(result).toContain('updateUser')
    })

    test('class implementing multiple interfaces', () => {
      const source = `
        export interface Disposable {
          dispose(): void;
        }

        export interface Serializable<T> {
          serialize(): string;
          deserialize(data: string): T;
        }

        export class Resource implements Disposable, Serializable<Resource> {
          constructor(public id: string, public name: string) {}

          dispose(): void {
            // cleanup
          }

          serialize(): string {
            return JSON.stringify({ id: this.id, name: this.name });
          }

          deserialize(data: string): Resource {
            const { id, name } = JSON.parse(data);
            return new Resource(id, name);
          }
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('interface Disposable')
      expect(result).toContain('interface Serializable<T>')
      expect(result).toContain('class Resource implements Disposable, Serializable<Resource>')
    })
  })

  describe('Module Patterns', () => {
    test('namespace with nested types', () => {
      const source = `
        export namespace API {
          export interface Request<T = unknown> {
            method: string;
            url: string;
            body?: T;
            headers?: Record<string, string>;
          }

          export interface Response<T = unknown> {
            status: number;
            data: T;
            headers: Record<string, string>;
          }

          export type Handler<Req = unknown, Res = unknown> = (
            request: Request<Req>
          ) => Promise<Response<Res>>;

          export namespace Errors {
            export class APIError extends Error {
              constructor(public status: number, message: string);
            }
          }
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('namespace API')
      expect(result).toContain('interface Request<T = unknown>')
      expect(result).toContain('interface Response<T = unknown>')
      expect(result).toContain('type Handler<Req = unknown, Res = unknown>')
      expect(result).toContain('namespace Errors')
    })

    test('declare module augmentation', () => {
      const source = `
        declare module 'express' {
          interface Request {
            user?: {
              id: string;
              email: string;
              roles: string[];
            };
          }
        }

        declare global {
          interface Window {
            analytics: {
              track(event: string, data?: Record<string, unknown>): void;
            };
          }
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('declare module \'express\'')
      expect(result).toContain('declare global')
    })
  })

  describe('Utility Type Patterns', () => {
    test('record and pick utilities', () => {
      const source = `
        export type Dict<T> = Record<string, T>;
        export type StringDict = Dict<string>;
        export type NumberDict = Dict<number>;

        export type UserKeys = 'id' | 'name' | 'email';
        export type UserRecord = Record<UserKeys, string>;

        export interface User {
          id: string;
          name: string;
          email: string;
          password: string;
          createdAt: Date;
        }

        export type PublicUser = Pick<User, 'id' | 'name' | 'email'>;
        export type UserCredentials = Pick<User, 'email' | 'password'>;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('type Dict<T> = Record<string, T>')
      expect(result).toContain('type StringDict = Dict<string>')
      expect(result).toContain('type UserKeys = \'id\' | \'name\' | \'email\'')
      expect(result).toContain('type UserRecord = Record<UserKeys, string>')
      expect(result).toContain('type PublicUser = Pick<User, \'id\' | \'name\' | \'email\'>')
    })

    test('omit and exclude utilities', () => {
      const source = `
        export interface User {
          id: string;
          name: string;
          email: string;
          password: string;
          salt: string;
        }

        export type SafeUser = Omit<User, 'password' | 'salt'>;

        export type Primitive = string | number | boolean | null | undefined;
        export type NonPrimitive<T> = Exclude<T, Primitive>;

        export type AllowedFields = 'name' | 'email' | 'age' | 'password';
        export type PublicFields = Exclude<AllowedFields, 'password'>;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('type SafeUser = Omit<User, \'password\' | \'salt\'>')
      expect(result).toContain('type Primitive = string | number | boolean | null | undefined')
      expect(result).toContain('type NonPrimitive<T> = Exclude<T, Primitive>')
    })
  })

  describe('Edge Cases', () => {
    test('deeply nested types', () => {
      const source = `
        export type DeepNested = {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    value: string;
                  };
                };
              };
            };
          };
        };

        export type PathOf<T, D extends number = 5> = [D] extends [never]
          ? never
          : T extends object
            ? { [K in keyof T]: K extends string
                ? \`\${K}\` | \`\${K}.\${PathOf<T[K], Prev[D]>}\`
                : never
              }[keyof T]
            : never;

        type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      `

      const result = generateDeclarations(source)

      expect(result).toContain('type DeepNested')
      expect(result).toContain('level5')
    })

    test('union with many members', () => {
      const source = `
        export type HTTPStatus =
          | 100 | 101 | 102 | 103
          | 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
          | 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308
          | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410
          | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;

        export type SuccessStatus = Extract<HTTPStatus, 200 | 201 | 202 | 203 | 204>;
        export type ErrorStatus = Extract<HTTPStatus, 400 | 401 | 403 | 404 | 500 | 502 | 503>;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('type HTTPStatus')
      expect(result).toContain('type SuccessStatus')
      expect(result).toContain('type ErrorStatus')
    })

    test('type with index signatures', () => {
      const source = `
        export interface Dictionary<T> {
          [key: string]: T;
        }

        export interface NumericDictionary<T> {
          [key: number]: T;
        }

        export interface MixedDictionary {
          [key: string]: unknown;
          [key: number]: string;
          length: number;
          name: string;
        }
      `

      const result = generateDeclarations(source)

      expect(result).toContain('interface Dictionary<T>')
      expect(result).toContain('[key: string]: T')
      expect(result).toContain('interface NumericDictionary<T>')
      expect(result).toContain('[key: number]: T')
      expect(result).toContain('interface MixedDictionary')
    })

    test('const assertions and literal types', () => {
      const source = `
        export const COLORS = ['red', 'green', 'blue'] as const;
        export type Color = typeof COLORS[number];

        export const CONFIG = {
          api: {
            baseUrl: 'https://api.example.com',
            timeout: 5000,
          },
          features: {
            darkMode: true,
            analytics: false,
          },
        } as const;

        export type Config = typeof CONFIG;
        export type APIConfig = typeof CONFIG.api;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('COLORS')
      expect(result).toContain('type Color')
      expect(result).toContain('CONFIG')
      expect(result).toContain('type Config')
    })

    test('callable and constructable types', () => {
      const source = `
        export interface Callable<T, R> {
          (arg: T): R;
        }

        export interface Constructable<T> {
          new (...args: any[]): T;
        }

        export interface CallableAndConstructable<T> {
          (): T;
          new (): T;
        }

        export type Constructor<T = {}> = new (...args: any[]) => T;
        export type AbstractConstructor<T = {}> = abstract new (...args: any[]) => T;
      `

      const result = generateDeclarations(source)

      expect(result).toContain('interface Callable<T, R>')
      expect(result).toContain('(arg: T): R')
      expect(result).toContain('interface Constructable<T>')
      expect(result).toContain('new (...args: any[]): T')
      expect(result).toContain('type Constructor<T = {}>')
      expect(result).toContain('type AbstractConstructor<T = {}>')
    })
  })
})

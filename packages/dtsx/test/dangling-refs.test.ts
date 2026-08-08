/**
 * A generated `.d.ts` can be perfectly well-formed and still unusable.
 *
 * When a source file leans on an ambient global — a type declared in some
 * project-wide `.d.ts` rather than imported — dtsx carries the reference into
 * the output, because that is what the source says. Inside the authoring repo
 * it resolves. In a consumer's node_modules it does not, and TypeScript
 * degrades the surrounding signature to an error type: a parameter becomes
 * `never`, which nothing can be assigned to, and no cast at the call site
 * helps.
 *
 * Nothing in the pipeline noticed. The build passed, the publish passed, and
 * the failure surfaced weeks later in somebody else's project as an error that
 * named neither the cause nor the package. These cover the detector that
 * stops that.
 *
 * The bar for this check is that it must not cry wolf: a false positive fails
 * a build over nothing. So the negative cases below outnumber the positive
 * ones, and the real-world calibration is that it flags zero of dtsx's own 64
 * declaration files.
 */

import { describe, expect, test } from 'bun:test'
import { findDanglingTypeReferences } from '../src/dangling-refs'

const names = (source: string): string[] =>
  findDanglingTypeReferences(source).map(reference => reference.name)

describe('finds references that resolve nowhere', () => {
  test('catches the ambient-global shape that motivated this', () => {
    // Exactly what @stacksjs/commerce emitted: no import for either name.
    const dts = `
      export declare function store(data: NewReviewInput): Promise<ReviewJsonResponse>;
      declare type ReviewJsonResponse = ModelRow<typeof Review>;
      declare type NewReviewInput = NewModelData<typeof Review>;
    `

    // Ordered by line, then by name within a line — ModelRow and Review share
    // one, NewModelData is on the next.
    expect(names(dts)).toEqual(['ModelRow', 'Review', 'NewModelData'])
  })

  test('catches an undefined return type', () => {
    expect(names('export declare function go(): Ghost;')).toEqual(['Ghost'])
  })

  test('catches an undefined parameter type', () => {
    expect(names('export declare function go(x: Phantom): void;')).toEqual(['Phantom'])
  })

  test('catches an undefined type in a heritage clause', () => {
    expect(names('export declare interface X extends Missing { a: string }')).toEqual(['Missing'])
  })

  test('catches an undefined generic argument', () => {
    expect(names('export declare const x: Promise<Absent>;')).toEqual(['Absent'])
  })

  test('reports the line it appears on', () => {
    const found = findDanglingTypeReferences('\n\nexport declare function go(): Ghost;')

    expect(found[0]?.line).toBe(3)
  })
})

describe('leaves resolved references alone', () => {
  test('a named import', () => {
    expect(names('import type { Foo } from "./foo"\nexport declare function go(a: Foo): void;')).toEqual([])
  })

  test('a default import', () => {
    expect(names('import Foo from "./foo"\nexport declare function go(a: Foo): void;')).toEqual([])
  })

  test('a renamed import', () => {
    expect(names('import { A as B } from "./a"\nexport declare function go(a: B): void;')).toEqual([])
  })

  test('a namespace import', () => {
    expect(names('import * as NS from "./n"\nexport declare function go(): NS.Thing;')).toEqual([])
  })

  test('an inline import type', () => {
    expect(names('export declare function go(): import("./m").Thing;')).toEqual([])
  })

  test('a type declared later in the same file', () => {
    expect(names('export declare function go(): Later;\ndeclare type Later = string;')).toEqual([])
  })

  test('type parameters on the declaration', () => {
    expect(names('export declare function map<T, U>(i: T[], f: (x: T) => U): U[];')).toEqual([])
  })

  test('a constrained type parameter', () => {
    expect(names('export declare function go<T extends string>(x: T): T;')).toEqual([])
  })

  test('`infer` in a conditional type', () => {
    // dtsx's own ExtractBase tripped on this before `infer` was collected.
    expect(names('export type ExtractBase<T> = T extends Brand<infer U, string> ? U : T;\ndeclare type Brand<A, B> = A & B;')).toEqual([])
  })

  test('a mapped type key', () => {
    expect(names('export type Flags<T> = { [K in keyof T]: boolean };')).toEqual([])
  })

  test('generics on a call signature', () => {
    expect(names('export declare const f: <T>(x: T) => T;')).toEqual([])
  })

  test('standard library types', () => {
    expect(names('export declare function go(a: Partial<Record<string, number>>): Readonly<Date>;')).toEqual([])
  })

  test('DOM and runtime globals', () => {
    // A package targeting the browser or Bun references these without importing.
    expect(names('export declare function go(r: Request): Promise<Response>;')).toEqual([])
    expect(names('export declare function read(b: Buffer): Uint8Array;')).toEqual([])
  })

  test('a name that only appears in a comment', () => {
    expect(names('/** returns a ModelRow */\nexport declare function go(): string;')).toEqual([])
  })

  test('a name that only appears in a string literal type', () => {
    expect(names('export declare type Kind = "ModelRow" | "Other";')).toEqual([])
  })

  test('property names inside an inline object type', () => {
    /*
     * `Tags?: Array<{ Key: string, Value: string }>` puts PascalCase members
     * exactly where a type would sit. Reading those as undefined types flagged
     * forty files of AWS-shaped declarations that were entirely correct.
     */
    const dts = 'export declare interface Role {\n  Tags?: Array<{\n    Key: string\n    Value: string\n  }>\n}'

    expect(names(dts)).toEqual([])
  })

  test('a member of an imported namespace', () => {
    expect(names('import * as ts from "typescript"\nexport declare function go(p: ts.Program): ts.SourceFile;')).toEqual([])
  })

  test('an empty file', () => {
    expect(names('')).toEqual([])
  })
})

describe('reporting', () => {
  test('carries the referencing declaration as context', () => {
    const found = findDanglingTypeReferences('declare type Row = ModelRow<string>;')

    expect(found[0]?.context).toContain('ModelRow')
  })

  test('reports each name once, ordered by line', () => {
    const found = findDanglingTypeReferences(
      'export declare function b(): Second;\ndeclare type X = Second;',
    )

    expect(found.map(f => f.name)).toEqual(['Second'])
  })
})

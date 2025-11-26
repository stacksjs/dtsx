/**
 * Lodash-like utility library types
 * Based on common patterns from lodash
 */

// Collection types
export type Collection<T> = T[] | Record<string, T>
export type List<T> = ArrayLike<T>
export type Many<T> = T | readonly T[]
export type PropertyName = string | number | symbol
export type PropertyPath = Many<PropertyName>

// Iteratee types
export type ListIterator<T, TResult> = (value: T, index: number, collection: List<T>) => TResult
export type ListIteratee<T> = ListIterator<T, unknown> | PropertyPath
export type ListIterateeCustom<T, TResult> = ListIterator<T, TResult> | PropertyPath

export type ObjectIterator<TObject, TResult> = (
  value: TObject[keyof TObject],
  key: string,
  collection: TObject
) => TResult

export type ObjectIteratee<TObject> = ObjectIterator<TObject, unknown> | PropertyPath

// Comparison
export type Comparator<T> = (a: T, b: T) => boolean
export type Comparator2<T1, T2> = (a: T1, b: T2) => boolean

// Deep types
export type PartialDeep<T> = T extends object
  ? { [P in keyof T]?: PartialDeep<T[P]> }
  : T

export type RequiredDeep<T> = T extends object
  ? { [P in keyof T]-?: RequiredDeep<T[P]> }
  : T

export type ReadonlyDeep<T> = T extends object
  ? { readonly [P in keyof T]: ReadonlyDeep<T[P]> }
  : T

// Object utilities
export interface Dictionary<T> {
  [key: string]: T
}

export interface NumericDictionary<T> {
  [key: number]: T
}

// Function utilities
export type AnyFunction = (...args: any[]) => any
export type Func<T extends AnyFunction> = (...args: Parameters<T>) => ReturnType<T>

// Array functions
export function chunk<T>(array: List<T>, size?: number): T[][]
export function compact<T>(array: List<T | null | undefined | false | '' | 0>): T[]
export function concat<T>(...values: Array<Many<T>>): T[]
export function difference<T>(array: List<T>, ...values: Array<List<T>>): T[]
export function differenceBy<T1, T2>(
  array: List<T1>,
  values: List<T2>,
  iteratee: ListIteratee<T1 | T2>
): T1[]
export function differenceWith<T1, T2>(
  array: List<T1>,
  values: List<T2>,
  comparator: Comparator2<T1, T2>
): T1[]
export function drop<T>(array: List<T>, n?: number): T[]
export function dropRight<T>(array: List<T>, n?: number): T[]
export function dropRightWhile<T>(array: List<T>, predicate?: ListIteratee<T>): T[]
export function dropWhile<T>(array: List<T>, predicate?: ListIteratee<T>): T[]
export function fill<T>(array: T[], value: T, start?: number, end?: number): T[]
export function findIndex<T>(array: List<T>, predicate?: ListIterateeCustom<T, boolean>, fromIndex?: number): number
export function findLastIndex<T>(array: List<T>, predicate?: ListIterateeCustom<T, boolean>, fromIndex?: number): number
export function first<T>(array: List<T>): T | undefined
export function flatten<T>(array: List<Many<T>>): T[]
export function flattenDeep<T>(array: List<T>): Array<T extends readonly (infer U)[] ? U : T>
export function flattenDepth<T>(array: List<T>, depth?: number): T[]
export function fromPairs<T>(pairs: List<[PropertyName, T]>): Dictionary<T>
export function head<T>(array: List<T>): T | undefined
export function indexOf<T>(array: List<T>, value: T, fromIndex?: number): number
export function initial<T>(array: List<T>): T[]
export function intersection<T>(...arrays: Array<List<T>>): T[]
export function intersectionBy<T1, T2>(
  array1: List<T1>,
  array2: List<T2>,
  iteratee: ListIteratee<T1 | T2>
): T1[]
export function intersectionWith<T1, T2>(
  array1: List<T1>,
  array2: List<T2>,
  comparator: Comparator2<T1, T2>
): T1[]
export function join(array: List<unknown>, separator?: string): string
export function last<T>(array: List<T>): T | undefined
export function lastIndexOf<T>(array: List<T>, value: T, fromIndex?: number): number
export function nth<T>(array: List<T>, n?: number): T | undefined
export function pull<T>(array: T[], ...values: T[]): T[]
export function pullAll<T>(array: T[], values: List<T>): T[]
export function pullAllBy<T1, T2>(array: T1[], values: List<T2>, iteratee?: ListIteratee<T1 | T2>): T1[]
export function pullAllWith<T1, T2>(array: T1[], values: List<T2>, comparator?: Comparator2<T1, T2>): T1[]
export function pullAt<T>(array: T[], ...indexes: Array<Many<number>>): T[]
export function remove<T>(array: T[], predicate?: ListIteratee<T>): T[]
export function reverse<T>(array: T[]): T[]
export function slice<T>(array: List<T>, start?: number, end?: number): T[]
export function sortedIndex<T>(array: List<T>, value: T): number
export function sortedIndexBy<T>(array: List<T>, value: T, iteratee?: ListIteratee<T>): number
export function sortedIndexOf<T>(array: List<T>, value: T): number
export function sortedLastIndex<T>(array: List<T>, value: T): number
export function sortedLastIndexBy<T>(array: List<T>, value: T, iteratee?: ListIteratee<T>): number
export function sortedLastIndexOf<T>(array: List<T>, value: T): number
export function sortedUniq<T>(array: List<T>): T[]
export function sortedUniqBy<T>(array: List<T>, iteratee?: ListIteratee<T>): T[]
export function tail<T>(array: List<T>): T[]
export function take<T>(array: List<T>, n?: number): T[]
export function takeRight<T>(array: List<T>, n?: number): T[]
export function takeRightWhile<T>(array: List<T>, predicate?: ListIteratee<T>): T[]
export function takeWhile<T>(array: List<T>, predicate?: ListIteratee<T>): T[]
export function union<T>(...arrays: Array<List<T>>): T[]
export function unionBy<T>(...iteratee: [List<T>, List<T>, ListIteratee<T>]): T[]
export function unionWith<T>(...comparator: [List<T>, List<T>, Comparator<T>]): T[]
export function uniq<T>(array: List<T>): T[]
export function uniqBy<T>(array: List<T>, iteratee: ListIteratee<T>): T[]
export function uniqWith<T>(array: List<T>, comparator: Comparator<T>): T[]
export function unzip<T>(array: T[][]): T[][]
export function unzipWith<T, TResult>(array: List<List<T>>, iteratee: (...values: T[]) => TResult): TResult[]
export function without<T>(array: List<T>, ...values: T[]): T[]
export function xor<T>(...arrays: Array<List<T>>): T[]
export function xorBy<T>(...iteratee: [List<T>, List<T>, ListIteratee<T>]): T[]
export function xorWith<T>(...comparator: [List<T>, List<T>, Comparator<T>]): T[]
export function zip<T1, T2>(array1: List<T1>, array2: List<T2>): Array<[T1 | undefined, T2 | undefined]>
export function zipObject<T>(props: List<PropertyName>, values: List<T>): Dictionary<T>
export function zipObjectDeep(paths: List<PropertyPath>, values: List<unknown>): object
export function zipWith<T, TResult>(
  arrays: List<T>,
  iteratee: (...values: T[]) => TResult
): TResult[]

// Collection functions
export function countBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): Dictionary<number>
export function each<T>(collection: List<T>, iteratee?: ListIterator<T, unknown>): List<T>
export function eachRight<T>(collection: List<T>, iteratee?: ListIterator<T, unknown>): List<T>
export function every<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>): boolean
export function filter<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>): T[]
export function find<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>, fromIndex?: number): T | undefined
export function findLast<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>, fromIndex?: number): T | undefined
export function flatMap<T, TResult>(collection: List<T>, iteratee?: ListIterator<T, Many<TResult>>): TResult[]
export function flatMapDeep<T, TResult>(collection: List<T>, iteratee?: ListIterator<T, TResult | List<TResult>>): TResult[]
export function flatMapDepth<T, TResult>(collection: List<T>, iteratee?: ListIterator<T, TResult | List<TResult>>, depth?: number): TResult[]
export function forEach<T>(collection: List<T>, iteratee?: ListIterator<T, unknown>): List<T>
export function forEachRight<T>(collection: List<T>, iteratee?: ListIterator<T, unknown>): List<T>
export function groupBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): Dictionary<T[]>
export function includes<T>(collection: List<T>, value: T, fromIndex?: number): boolean
export function invokeMap(collection: object, path: PropertyPath, ...args: unknown[]): unknown[]
export function keyBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): Dictionary<T>
export function map<T, TResult>(collection: List<T>, iteratee: ListIterator<T, TResult>): TResult[]
export function orderBy<T>(collection: List<T>, iteratees?: Many<ListIteratee<T>>, orders?: Many<boolean | 'asc' | 'desc'>): T[]
export function partition<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>): [T[], T[]]
export function reduce<T, TResult>(collection: List<T>, iteratee: (accumulator: TResult, value: T, index: number) => TResult, accumulator: TResult): TResult
export function reduceRight<T, TResult>(collection: List<T>, iteratee: (accumulator: TResult, value: T, index: number) => TResult, accumulator: TResult): TResult
export function reject<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>): T[]
export function sample<T>(collection: List<T>): T | undefined
export function sampleSize<T>(collection: List<T>, n?: number): T[]
export function shuffle<T>(collection: List<T>): T[]
export function size(collection: object | string | null | undefined): number
export function some<T>(collection: List<T>, predicate?: ListIterateeCustom<T, boolean>): boolean
export function sortBy<T>(collection: List<T>, ...iteratees: Array<Many<ListIteratee<T>>>): T[]

// Object functions
export function assign<TObject, TSource>(object: TObject, source: TSource): TObject & TSource
export function assignIn<TObject, TSource>(object: TObject, source: TSource): TObject & TSource
export function assignInWith<TObject, TSource>(object: TObject, source: TSource, customizer: (objValue: any, srcValue: any, key: string, object: TObject, source: TSource) => any): TObject & TSource
export function assignWith<TObject, TSource>(object: TObject, source: TSource, customizer: (objValue: any, srcValue: any, key: string, object: TObject, source: TSource) => any): TObject & TSource
export function at<T>(object: Dictionary<T>, ...paths: PropertyPath[]): T[]
export function create<T extends object>(prototype: T, properties?: object): T
export function defaults<TObject, TSource>(object: TObject, ...sources: TSource[]): TObject & TSource
export function defaultsDeep<TObject, TSource>(object: TObject, ...sources: TSource[]): TObject & TSource
export function entries<T>(object: Dictionary<T>): Array<[string, T]>
export function entriesIn<T>(object: Dictionary<T>): Array<[string, T]>
export function extend<TObject, TSource>(object: TObject, source: TSource): TObject & TSource
export function extendWith<TObject, TSource>(object: TObject, source: TSource, customizer: (objValue: any, srcValue: any, key: string) => any): TObject & TSource
export function findKey<T>(object: Dictionary<T>, predicate?: ObjectIteratee<Dictionary<T>>): string | undefined
export function findLastKey<T>(object: Dictionary<T>, predicate?: ObjectIteratee<Dictionary<T>>): string | undefined
export function forIn<T>(object: Dictionary<T>, iteratee?: ObjectIterator<Dictionary<T>, unknown>): Dictionary<T>
export function forInRight<T>(object: Dictionary<T>, iteratee?: ObjectIterator<Dictionary<T>, unknown>): Dictionary<T>
export function forOwn<T>(object: Dictionary<T>, iteratee?: ObjectIterator<Dictionary<T>, unknown>): Dictionary<T>
export function forOwnRight<T>(object: Dictionary<T>, iteratee?: ObjectIterator<Dictionary<T>, unknown>): Dictionary<T>
export function functions(object: object): string[]
export function functionsIn(object: object): string[]
export function get<T>(object: Dictionary<T>, path: PropertyPath, defaultValue?: T): T
export function has(object: object, path: PropertyPath): boolean
export function hasIn(object: object, path: PropertyPath): boolean
export function invert(object: object): Dictionary<string>
export function invertBy<T>(object: Dictionary<T>, iteratee?: (value: T) => string): Dictionary<string[]>
export function invoke(object: object, path: PropertyPath, ...args: unknown[]): unknown
export function keys(object: object): string[]
export function keysIn(object: object): string[]
export function mapKeys<T>(object: Dictionary<T>, iteratee?: ObjectIterator<Dictionary<T>, string>): Dictionary<T>
export function mapValues<T, TResult>(object: Dictionary<T>, iteratee: ObjectIterator<Dictionary<T>, TResult>): Dictionary<TResult>
export function merge<TObject, TSource>(object: TObject, source: TSource): TObject & TSource
export function mergeWith<TObject, TSource>(object: TObject, source: TSource, customizer: (objValue: any, srcValue: any, key: string) => any): TObject & TSource
export function omit<T extends object, K extends keyof T>(object: T, ...paths: K[]): Omit<T, K>
export function omitBy<T>(object: Dictionary<T>, predicate?: ObjectIteratee<Dictionary<T>>): Dictionary<T>
export function pick<T extends object, K extends keyof T>(object: T, ...paths: K[]): Pick<T, K>
export function pickBy<T>(object: Dictionary<T>, predicate?: ObjectIteratee<Dictionary<T>>): Dictionary<T>
export function result<T>(object: object, path: PropertyPath, defaultValue?: T): T
export function set<T extends object>(object: T, path: PropertyPath, value: unknown): T
export function setWith<T extends object>(object: T, path: PropertyPath, value: unknown, customizer?: (nsValue: any, key: string, nsObject: T) => any): T
export function toPairs<T>(object: Dictionary<T>): Array<[string, T]>
export function toPairsIn<T>(object: Dictionary<T>): Array<[string, T]>
export function transform<T, TResult>(object: T[], iteratee: (accumulator: TResult, value: T, index: number) => void, accumulator?: TResult): TResult
export function unset(object: object, path: PropertyPath): boolean
export function update<T extends object>(object: T, path: PropertyPath, updater: (value: any) => any): T
export function updateWith<T extends object>(object: T, path: PropertyPath, updater: (value: any) => any, customizer?: (nsValue: any, key: string, nsObject: T) => any): T
export function values<T>(object: Dictionary<T>): T[]
export function valuesIn<T>(object: Dictionary<T>): T[]

// String functions
export function camelCase(string?: string): string
export function capitalize(string?: string): string
export function deburr(string?: string): string
export function endsWith(string?: string, target?: string, position?: number): boolean
export function escape(string?: string): string
export function escapeRegExp(string?: string): string
export function kebabCase(string?: string): string
export function lowerCase(string?: string): string
export function lowerFirst(string?: string): string
export function pad(string?: string, length?: number, chars?: string): string
export function padEnd(string?: string, length?: number, chars?: string): string
export function padStart(string?: string, length?: number, chars?: string): string
export function parseInt(string: string, radix?: number): number
export function repeat(string?: string, n?: number): string
export function replace(string: string, pattern: RegExp | string, replacement: string | ((match: string) => string)): string
export function snakeCase(string?: string): string
export function split(string?: string, separator?: RegExp | string, limit?: number): string[]
export function startCase(string?: string): string
export function startsWith(string?: string, target?: string, position?: number): boolean
export function template(string?: string, options?: TemplateOptions): TemplateExecutor
export function toLower(string?: string): string
export function toUpper(string?: string): string
export function trim(string?: string, chars?: string): string
export function trimEnd(string?: string, chars?: string): string
export function trimStart(string?: string, chars?: string): string
export function truncate(string?: string, options?: TruncateOptions): string
export function unescape(string?: string): string
export function upperCase(string?: string): string
export function upperFirst(string?: string): string
export function words(string?: string, pattern?: string | RegExp): string[]

export interface TemplateOptions {
  escape?: RegExp
  evaluate?: RegExp
  imports?: Dictionary<unknown>
  interpolate?: RegExp
  sourceURL?: string
  variable?: string
}

export interface TemplateExecutor {
  (data?: object): string
  source: string
}

export interface TruncateOptions {
  length?: number
  omission?: string
  separator?: string | RegExp
}

// Function utilities
export function after<T extends AnyFunction>(n: number, func: T): T
export function ary<T extends AnyFunction>(func: T, n?: number): T
export function before<T extends AnyFunction>(n: number, func: T): T
export function bind<T extends AnyFunction>(func: T, thisArg: any, ...partials: any[]): T
export function bindKey(object: object, key: string, ...partials: any[]): AnyFunction
export function curry<T extends AnyFunction>(func: T, arity?: number): T
export function curryRight<T extends AnyFunction>(func: T, arity?: number): T
export function debounce<T extends AnyFunction>(func: T, wait?: number, options?: DebounceSettings): T & Cancelable
export function defer(func: AnyFunction, ...args: any[]): number
export function delay(func: AnyFunction, wait: number, ...args: any[]): number
export function flip<T extends AnyFunction>(func: T): T
export function memoize<T extends AnyFunction>(func: T, resolver?: (...args: any[]) => any): T & MemoizedFunction
export function negate<T extends AnyFunction>(predicate: T): T
export function once<T extends AnyFunction>(func: T): T
export function overArgs<T extends AnyFunction>(func: T, ...transforms: AnyFunction[]): T
export function partial<T extends AnyFunction>(func: T, ...partials: any[]): T
export function partialRight<T extends AnyFunction>(func: T, ...partials: any[]): T
export function rearg<T extends AnyFunction>(func: T, ...indexes: number[]): T
export function rest<T extends AnyFunction>(func: T, start?: number): T
export function spread<T extends AnyFunction>(func: T, start?: number): T
export function throttle<T extends AnyFunction>(func: T, wait?: number, options?: ThrottleSettings): T & Cancelable
export function unary<T extends AnyFunction>(func: T): T
export function wrap<T extends AnyFunction>(value: any, wrapper: (value: any, ...args: any[]) => any): T

export interface DebounceSettings {
  leading?: boolean
  maxWait?: number
  trailing?: boolean
}

export interface ThrottleSettings {
  leading?: boolean
  trailing?: boolean
}

export interface Cancelable {
  cancel(): void
  flush(): void
}

export interface MemoizedFunction {
  cache: Map<any, any>
}

// Utility functions
export function attempt<T>(func: (...args: any[]) => T, ...args: any[]): T | Error
export function bindAll(object: object, ...methodNames: string[]): object
export function cond<T, TResult>(pairs: Array<[(value: T) => boolean, (value: T) => TResult]>): (value: T) => TResult
export function conforms<T>(source: Partial<T>): (value: T) => boolean
export function constant<T>(value: T): () => T
export function defaultTo<T>(value: T | null | undefined, defaultValue: T): T
export function flow<T extends AnyFunction>(...funcs: AnyFunction[]): T
export function flowRight<T extends AnyFunction>(...funcs: AnyFunction[]): T
export function identity<T>(value: T): T
export function iteratee<T>(func?: T): T
export function matches<T>(source: T): (value: T) => boolean
export function matchesProperty<T>(path: PropertyPath, srcValue: T): (value: any) => boolean
export function method(path: PropertyPath, ...args: any[]): (object: object) => any
export function methodOf(object: object, ...args: any[]): (path: PropertyPath) => any
export function mixin<T extends object>(object: T, source: object, options?: MixinOptions): T
export function noConflict(): typeof import('./lodash-like')
export function noop(): void
export function nthArg(n?: number): (...args: any[]) => any
export function over<T>(...iteratees: AnyFunction[]): (...args: any[]) => T[]
export function overEvery<T>(...predicates: Array<(value: T) => boolean>): (value: T) => boolean
export function overSome<T>(...predicates: Array<(value: T) => boolean>): (value: T) => boolean
export function property<T>(path: PropertyPath): (object: any) => T
export function propertyOf(object: object): (path: PropertyPath) => any
export function range(start: number, end?: number, step?: number): number[]
export function rangeRight(start: number, end?: number, step?: number): number[]
export function stubArray(): any[]
export function stubFalse(): false
export function stubObject(): object
export function stubString(): string
export function stubTrue(): true
export function times<T>(n: number, iteratee?: (num: number) => T): T[]
export function toPath(value: PropertyPath): string[]
export function uniqueId(prefix?: string): string

export interface MixinOptions {
  chain?: boolean
}

// Lang functions
export function castArray<T>(value?: Many<T>): T[]
export function clone<T>(value: T): T
export function cloneDeep<T>(value: T): T
export function cloneDeepWith<T>(value: T, customizer: (value: any, key: number | string | undefined, object: any, stack: any) => any): T
export function cloneWith<T>(value: T, customizer: (value: any, key: number | string | undefined, object: any, stack: any) => any): T
export function conformsTo<T>(object: T, source: Partial<T>): boolean
export function eq(value: any, other: any): boolean
export function gt(value: any, other: any): boolean
export function gte(value: any, other: any): boolean
export function isArguments(value?: any): value is IArguments
export function isArray(value?: any): value is any[]
export function isArrayBuffer(value?: any): value is ArrayBuffer
export function isArrayLike<T>(value?: any): value is ArrayLike<T>
export function isArrayLikeObject<T>(value?: any): value is ArrayLike<T> & object
export function isBoolean(value?: any): value is boolean
export function isBuffer(value?: any): boolean
export function isDate(value?: any): value is Date
export function isElement(value?: any): boolean
export function isEmpty(value?: any): boolean
export function isEqual(value: any, other: any): boolean
export function isEqualWith(value: any, other: any, customizer: (objValue: any, othValue: any) => boolean | undefined): boolean
export function isError(value: any): value is Error
export function isFinite(value?: any): boolean
export function isFunction(value: any): value is AnyFunction
export function isInteger(value?: any): boolean
export function isLength(value?: any): boolean
export function isMap(value?: any): value is Map<any, any>
export function isMatch(object: object, source: object): boolean
export function isMatchWith(object: object, source: object, customizer: (objValue: any, srcValue: any) => boolean | undefined): boolean
export function isNaN(value?: any): boolean
export function isNative(value: any): value is AnyFunction
export function isNil(value: any): value is null | undefined
export function isNull(value: any): value is null
export function isNumber(value?: any): value is number
export function isObject(value?: any): value is object
export function isObjectLike(value?: any): boolean
export function isPlainObject(value?: any): boolean
export function isRegExp(value?: any): value is RegExp
export function isSafeInteger(value?: any): boolean
export function isSet(value?: any): value is Set<any>
export function isString(value?: any): value is string
export function isSymbol(value?: any): value is symbol
export function isTypedArray(value: any): boolean
export function isUndefined(value: any): value is undefined
export function isWeakMap(value?: any): value is WeakMap<any, any>
export function isWeakSet(value?: any): value is WeakSet<any>
export function lt(value: any, other: any): boolean
export function lte(value: any, other: any): boolean
export function toArray<T>(value: Dictionary<T>): T[]
export function toFinite(value: any): number
export function toInteger(value: any): number
export function toLength(value: any): number
export function toNumber(value: any): number
export function toPlainObject<T>(value: T): T
export function toSafeInteger(value: any): number
export function toString(value: any): string

// Math functions
export function add(augend: number, addend: number): number
export function ceil(n: number, precision?: number): number
export function divide(dividend: number, divisor: number): number
export function floor(n: number, precision?: number): number
export function max<T>(collection: List<T>): T | undefined
export function maxBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): T | undefined
export function mean(collection: List<number>): number
export function meanBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): number
export function min<T>(collection: List<T>): T | undefined
export function minBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): T | undefined
export function multiply(multiplier: number, multiplicand: number): number
export function round(n: number, precision?: number): number
export function subtract(minuend: number, subtrahend: number): number
export function sum(collection: List<number>): number
export function sumBy<T>(collection: List<T>, iteratee?: ListIteratee<T>): number

// Number functions
export function clamp(number: number, lower: number, upper: number): number
export function inRange(number: number, start: number, end?: number): boolean
export function random(lower?: number, upper?: number, floating?: boolean): number

// Chaining
export interface LoDashWrapper<T> {
  value(): T
  valueOf(): T
  toJSON(): T
}

export function chain<T>(value: T): LoDashWrapper<T>

// Version
export const VERSION: string

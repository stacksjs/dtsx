import { expect, test } from 'bun:test'
import { extractDeclarations } from '../src/extractor'
import { isRegexStart } from '../src/lexical'

const chained = String.raw`function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1')
}`

test('regex slashes in earlier replacement arguments are not line comments', () => {
  for (const needle of [String.raw`/\/\*`, '/^', '/,']) {
    const position = chained.indexOf(needle)
    expect(position).toBeGreaterThan(0)
    expect(isRegexStart(chained, position), needle).toBe(true)
  }
})

test('a private body with chained regex arguments retains subsequent exports', () => {
  const source = `${chained}\nexport function after(value: string): number { return value.length }`
  expect(extractDeclarations(source, 'chained-regex.ts').filter(item => item.isExported).map(item => item.name)).toEqual(['after'])
})

test('regex trivia scanning preserves real comments and expression boundaries', () => {
  const cases: Array<[string, boolean]> = [
    [String.raw`const first = /[//]/; const next = /\(/`, true],
    [String.raw`const first = /[//]/; /* // ignored */ const next = /\(/`, true],
    [String.raw`const first = /[//]/; // an actual comment (
      /\(/`, true],
    [String.raw`const url = 'https://example.test'; const next = /\(/`, true],
    [String.raw`const first = /[//]/; const quotient = total /\(/`, false],
    [String.raw`const first = /[//]/; const quotient = object.return /\(/`, false],
    [String.raw`if (ready) /[//]/.test(input); const next = /\(/`, true],
    [String.raw`if (
      ready) /[//]/.test(input); const next = /\(/`, true],
    [String.raw`object.if(ready) / count // division, then a comment
      /\(/`, false],
  ]
  for (const [source, expected] of cases)
    expect(isRegexStart(source, source.lastIndexOf(String.raw`/\(/`)), source).toBe(expected)
})

test('line-leading division retains its comment and the following export', () => {
  for (const expression of ['total', 'total++', 'total--', 'total!', 'object.\n    return']) {
    const source = `function ratio(total: number, divisor: number, object: { return: number }): number {
    return ${expression}
    / 2 // return
    / divisor }
export const after = 1`
    expect(isRegexStart(source, source.indexOf('/ divisor')), expression).toBe(false)
    expect(extractDeclarations(source, 'division.ts').filter(item => item.isExported).map(item => item.name), expression).toEqual(['after'])
  }
})

test('same-line postfix division preserves a following real comment', () => {
  const source = `function ratio(total: number, divisor: number): number {
    return total++ / divisor // actual comment {
    / 2
  }
export const after = 1`
  expect(isRegexStart(source, source.indexOf('/ divisor'))).toBe(false)
  expect(extractDeclarations(source, 'postfix-division.ts').filter(item => item.isExported).map(item => item.name)).toEqual(['after'])
})

test('long division continuations resolve context without recursive comment scanning', () => {
  const source = `function ratio(total: number): number {
    return total
${'    / 2 // return\n'.repeat(3000)}    / 1 }
export const after = 1`
  expect(isRegexStart(source, source.lastIndexOf('/ 1'))).toBe(false)
  expect(extractDeclarations(source, 'long-division.ts').filter(item => item.isExported).map(item => item.name)).toEqual(['after'])
})

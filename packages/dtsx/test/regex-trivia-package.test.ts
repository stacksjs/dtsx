import { test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

const bodies = {
  chained: String.raw`return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1')`,
  characterClass: String.raw`return source.replace(/[//]/g, '').replace(/\{/g, '')`,
  blockComment: String.raw`return source.replace(/[//]/g, '') /* // is block trivia */.replace(/\(/g, '')`,
  controlHeader: String.raw`if (source) /[//]/.test(source); return source.replace(/[//]/g, '').replace(/\(/g, '')`,
  divisionContinuation: `const ratio = source.length
    / 2 // return
    / 1; return String(ratio)`,
  postfixContinuation: `let total = source.length; const ratio = total++
    / 2 // return
    / 1; return String(ratio)`,
  memberContinuation: `const object = { return: source.length }; const ratio = object.
    return / 2 // return
    / 1; return String(ratio)`,
  nonnullContinuation: `const ratio = source.length!
    / 2 // return
    / 1; return String(ratio)`,
  sameLinePostfix: `let total = source.length; const ratio = total++ / 2 // actual comment {
    / 1; return String(ratio)`,
  deepParentheses: `const deep = ${'('.repeat(257)}source.length${')'.repeat(257)}; const ratio = deep / 2 // return
    / 1; return String(ratio)`,
  deepTemplates: `const deep = ${'`${'.repeat(65)}source.length${'}`'.repeat(65)}; const ratio = Number(deep) / 2 // return
    / 1; return String(ratio)`,
}
for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
  for (const isolatedDeclarations of [false, true]) {
    for (const [name, body] of Object.entries(bodies)) {
      test(`${producer} retains exports after ${name} regex trivia (isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `function strip(source: string): string { ${body} }\nexport function after(value: string): number { return strip(value).length }`,
          positive: `const result: number = api.after('text'); type IsAny<T> = 0 extends (1 & T) ? true : false; const safe: false = null as unknown as IsAny<ReturnType<typeof api.after>>; void [result, safe];`,
          negatives: [
            { code: 2345, content: 'api.after(42)' },
            { code: 2322, content: "const wrong: string = api.after('text'); void wrong;" },
          ],
        })
      }, 30_000)
    }
  }
}

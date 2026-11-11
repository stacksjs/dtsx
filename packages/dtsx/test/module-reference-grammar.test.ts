import { expect, test } from 'bun:test'
import { rewriteModuleSpecifiers, scanReExportSpecifiers } from '../src/module-graph'
import { createJsxTagReader } from '../src/lexical'
import { tokenizeDeclarationSyntax } from '../src/module-references'

test.each([8, 32, 128, 256])('nested JSX attribute headers retain all openers and following code at depth %i', (depth) => {
  const source = `export const tree = ${'<A child={'.repeat(depth)}<A />${'} />'.repeat(depth)}; export const after = 1`
  const opening = source.indexOf('<')
  const read = createJsxTagReader(source)
  expect(read(opening)).toEqual({ delta: 0, end: source.indexOf(';') - 1 })
  const tokens = tokenizeDeclarationSyntax(source).map(token => source.slice(token.start, token.end))
  expect(tokens.filter(token => token === '<')).toHaveLength(depth + 1)
  expect(tokens.slice(-6)).toEqual([';', 'export', 'const', 'after', '=', '1'])
})

test('module references include nested template substitutions while ignoring literal text and regular expressions', () => {
  const source = [
    "export type Name = `raw import('./fake') ${`nested:${import('./names').Name}`}`",
    "const literal = `escaped \\${import('./escaped')}`",
    "const pattern = /import\\('fake-regex'\\)/",
    "// export * from './comment'",
    "const text = \"export * from './quoted'\"",
  ].join('\n')
  expect(scanReExportSpecifiers(source, { includeImports: true }).map(reference => reference.specifier)).toEqual(['./names'])
  const rewritten = rewriteModuleSpecifiers(source, specifier => `${specifier}.js`)
  expect(rewritten).toBe(source.replace("import('./names')", "import('./names.js')"))
})

test('module rewrites decode escaped paths and preserve unchanged original spelling', () => {
  const source = "export type { Value } from '\\u002e/options';\nimport type Options = require( /* target */ './options.cjs' );"
  const seen: string[] = []
  expect(rewriteModuleSpecifiers(source, specifier => { seen.push(specifier); return specifier })).toBe(source)
  expect(seen).toEqual(['./options', './options.cjs'])
  expect(rewriteModuleSpecifiers(source, specifier => specifier === './options' ? './options.js' : specifier)).toBe(source.replace("'\\u002e/options'", "'./options.js'"))
})

test('rewriting a module value escapes quotes and controls without changing adjacent source', () => {
  const source = "export type { Value } from './options'; // original\n"
  expect(rewriteModuleSpecifiers(source, () => "./option's\nvalue")).toBe("export type { Value } from './option\\'s\\u000avalue'; // original\n")
})

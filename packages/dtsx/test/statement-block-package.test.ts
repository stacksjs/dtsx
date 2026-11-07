import { test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

// #3148: a completed statement block cannot consume the next same-line export.
const statements = [
  { name: 'if block', source: 'if (Math.random() > 0.5) { const local = 1 }' },
  { name: 'if/else chain', source: 'if (Math.random() > 0.5) {} else if (Math.random() > 0.5) {} else {}' },
  { name: 'try/catch/finally chain', source: 'try { throw 1 } catch (error) { void error } finally { const local = 1 }' },
  { name: 'do/while continuation', source: 'do {} while (false);' },
  { name: 'while block', source: 'while (Math.random() < 0) {}' },
  { name: 'for block', source: 'for (const item of [1, 2]) { void item }' },
  { name: 'switch block', source: 'switch (Math.random()) { case 1: break; default: break }' },
  { name: 'nested blocks and regex delimiters', source: 'if (/[{}]/.test("")) { if (Math.random() > 0.5) {} }' },
] as const

for (const fixture of statements) {
  for (const producer of ['core', 'bun-plugin', 'native'] as const) {
    test(`${producer} preserves an export following a completed ${fixture.name}`, async () => {
      await checkDeclarationPackage(producer, {
        source: `${fixture.source} /* boundary */ export const value = 7`,
        positive: 'const value: 7 = api.value',
        negatives: [{ code: 2322, content: 'const value: string = api.value' }],
      })
    })
  }
}

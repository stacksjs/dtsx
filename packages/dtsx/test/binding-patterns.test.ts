import { expect, test } from 'bun:test'
import { bindingPatternNames, projectBindingPattern } from '../src/binding-patterns'
import vectors from '../../zig-dtsx/src/fixtures/binding-patterns.json'

for (const vector of vectors) {
  test(`binding targets preserve only declared names in ${vector.pattern}`, () => {
    expect(bindingPatternNames(vector.pattern)).toEqual(vector.names)
    let counter = 0
    const declarations = projectBindingPattern({ pattern: vector.pattern, patternOffset: 10,
      root: { kind: 'variable', name: '__root', text: 'declare const __root: unknown;', isExported: false, start: 0, end: 100 },
      kind: 'const', exported: true, allocateName: () => `__project_${counter++}` })
    expect(declarations.filter(declaration => declaration.isExported).map(declaration => declaration.name)).toEqual(vector.names)
    if (vector.names.length) expect(declarations[0].isExported).toBe(false)
  })
}

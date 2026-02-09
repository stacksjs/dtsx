import { createSourceFile, ScriptKind, ScriptTarget } from 'typescript'

const sf = createSourceFile('test.ts', 'export const x: number = 1', ScriptTarget.Latest, true, ScriptKind.TS)
console.log(sf.statements.length)

import { parseSync } from 'oxc-parser'

const result = parseSync('test.ts', 'export const x: number = 1')
console.log(JSON.parse(result.program).body.length)

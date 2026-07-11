import { describe, expect, it } from 'bun:test'
import { validateTypeScriptSyntax } from '../src/syntax-validator'

describe('syntax validator', () => {
  it('accepts type-only import and export syntax', () => {
    const source = `import type { Input } from './input';\nexport type { Input };`

    expect(validateTypeScriptSyntax(source)).toEqual([])
  })

  it('still rejects type aliases without a name', () => {
    const [issue] = validateTypeScriptSyntax(`type = string`)

    expect(issue?.code).toBe('DTSX1005')
    expect(issue?.message).toBe('Declaration name expected')
  })
})

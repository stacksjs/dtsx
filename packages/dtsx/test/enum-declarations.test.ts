import { expect, test } from 'bun:test'
import { lowerEnumBody } from '../src/enum-declarations'

const vectors: unknown = await Bun.file(new URL('../../zig-dtsx/src/fixtures/enum-declarations.json', import.meta.url)).json()
if (!Array.isArray(vectors)) throw new Error('Enum vectors must be an array')
for (const vector of vectors) {
  if (!vector || typeof vector.input !== 'string' || typeof vector.expected !== 'string') throw new Error('Enum vectors require source and expected strings')
  test(`ambient enum lowering preserves ${vector.input}`, () => {
    const constants = new Map<string, number | string>()
    for (const binding of vector.constants ?? []) constants.set(binding.name, binding.number ?? binding.text)
    expect(lowerEnumBody(vector.input, 'E', constants).body).toBe(vector.expected)
  })
}

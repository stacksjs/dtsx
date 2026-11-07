import { expect, test } from 'bun:test'
import { normalizeDefaultParameterOrder } from '../src/parameters'

const vectors: unknown = await Bun.file(new URL('../../zig-dtsx/src/fixtures/parameter-order.json', import.meta.url)).json()
if (!Array.isArray(vectors)) throw new Error('Parameter vectors must be an array')
for (const vector of vectors) {
  if (!vector || typeof vector.input !== 'string' || typeof vector.expected !== 'string') throw new Error('Parameter vectors require source and expected strings')
  test(`parameter order preserves ${vector.input}`, () => {
    expect(normalizeDefaultParameterOrder(vector.input)).toBe(vector.expected)
  })
}

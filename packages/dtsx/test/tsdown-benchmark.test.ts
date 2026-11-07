import { expect, test } from 'bun:test'
import { runTsdownComparison, tsdownComparisonMarkdown } from '../../../benchmark/tsdown'

test('tsdown comparison measures real fresh declaration builds with strict compiler controls', async () => {
  const result = await runTsdownComparison({ counts: [1], iterations: 1, warmup: 0 })
  expect(result.results.map(row => row.tool)).toEqual(['dtsx', 'tsdown'])
  for (const row of result.results) {
    expect(row.files).toBe(2)
    expect(row.iterations).toBe(1)
    expect(row.avgMs).toBeGreaterThan(0)
    expect(row.outputSha256).toMatch(/^[a-f0-9]{64}$/)
  }
  expect(tsdownComparisonMarkdown(result)).toContain(`tsdown ${result.tsdown}`)
})

import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Step { name?: string, id?: string, run?: string, uses?: string, with?: { version?: string | number } }
interface Workflow { jobs: Record<string, { steps?: Step[] }> }
const source = await readFile(resolve(import.meta.dir, '../../../.github/workflows/release.yml'), 'utf8')
const workflow = Bun.YAML.parse(source) as Workflow
const steps = workflow.jobs.release.steps!

test('the public SDK gate runs after native and JavaScript payload assembly', () => {
  const native = steps.findIndex(step => step.run?.includes('zig build cli'))
  const library = steps.findIndex(step => step.run?.includes('bun run build'))
  const gate = steps.findIndex(step => step.id === 'public-sdk')
  expect(native).toBeGreaterThan(-1)
  expect(library).toBeGreaterThan(native)
  expect(gate).toBeGreaterThan(library)
  const later = steps.slice(gate + 1).flatMap(step => step.run ? [step.run] : [])
  expect(later.filter(run => /(?:bun run build|zig build|--filter .* build)/.test(run))).toEqual([])
})

test('both registries upload qualified payloads without lifecycle rebuilds', () => {
  const publications = steps.filter(step => step.run?.includes('pantry publish'))
  expect(publications).toHaveLength(2)
  for (const step of publications) expect(step.run).toContain('--ignore-scripts')
  expect(publications.some(step => step.run?.includes('--npm'))).toBe(true)
  expect(publications.some(step => step.run?.includes('--verify-existing'))).toBe(true)
})

test('release publication uses the verified immutable Pantry lifecycle implementation', () => {
  const pantry = steps.filter(step => step.uses?.startsWith('pantry-pm/pantry/packages/action@'))
  expect(pantry.length).toBeGreaterThan(0)
  for (const step of pantry) {
    expect(step.uses).toBe('pantry-pm/pantry/packages/action@362da3ef0602f51232ab9431da8d05c84c5f49ba')
    expect(String(step.with?.version)).toBe('0.11.197')
  }
})

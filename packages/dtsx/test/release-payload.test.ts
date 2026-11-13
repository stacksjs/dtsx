import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Step { name?: string, id?: string, run?: string, uses?: string, with?: { version?: string | number, name?: string, path?: string } }
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

test('the separately published FFI SDK is qualified and retained before registry publication', () => {
  const assembled = steps.findIndex(step => step.name === 'Build JavaScript library and plugins')
  const ffi = steps.findIndex(step => step.id === 'ffi-sdk')
  const retained = steps.findIndex(step => step.id === 'ffi-sdk-evidence')
  const publication = steps.findIndex(step => step.run?.includes('pantry publish'))
  expect(ffi).toBeGreaterThan(assembled)
  expect(steps[ffi]?.run).toContain('test:ffi-sdk --all-platforms')
  expect(retained).toBeGreaterThan(ffi)
  expect(retained).toBeLessThan(publication)
  expect(steps[retained]?.with?.name).toBe('ffi-sdk-release')
  expect(steps[retained]?.with?.path).toBe('${{ runner.temp }}/ffi-sdk')
})

test('release publication uses the verified immutable Pantry lifecycle implementation', () => {
  const pantry = steps.filter(step => step.uses?.startsWith('pantry-pm/pantry/packages/action@'))
  expect(pantry.length).toBeGreaterThan(0)
  // Qualified canonical 0.11.204: public archive identity, original ZIP modes
  // and strict normally installed SDK consumers were verified before adoption.
  for (const step of pantry) {
    expect(step.uses).toBe('pantry-pm/pantry/packages/action@fe21b9517e2da3f63c53069845f0b31965bc92d8')
    expect(String(step.with?.version)).toBe('0.11.204')
  }
})

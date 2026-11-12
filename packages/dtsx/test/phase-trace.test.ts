import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

for (const asynchronous of [false, true]) {
  test(`failed ${asynchronous ? 'async' : 'sync'} observation fails the real Bun test gate`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-phase-gate-'))
    try {
      const helper = pathToFileURL(join(import.meta.dir, 'helpers/phase-trace.ts')).href
      await writeFile(join(directory, 'probe.test.ts'), `
import { expect, test } from 'bun:test'
import { traceSync, traceAsync } from ${JSON.stringify(helper)}
test('operation still succeeds', async () => {
  const value = { preserved: true }
  const result = ${asynchronous ? 'await traceAsync("probe", async () => value)' : 'traceSync("probe", () => value)'}
  expect(result).toBe(value)
})
`)
      const child = Bun.spawn([process.execPath, 'test', '--no-env-file', './probe.test.ts'], {
        cwd: directory, env: { ...process.env, DTSX_TEST_TRACE: directory }, stdout: 'pipe', stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect(code, stdout + stderr).toBe(1)
      expect(stderr).toContain('(pass) operation still succeeds')
      expect(stderr).toContain('DTSX phase observation failed')
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  for (const scenario of ['disabled', 'directory', 'end-directory', 'operation-error', 'operation-error-valid', 'operation-error-format', 'getter-error', 'timing'] as const) {
    test(`phase observation preserves ${asynchronous ? 'async' : 'sync'} operations with ${scenario}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dtsx-phase-observation-'))
      try {
        const destination = join(directory, 'trace.jsonl')
        const helper = pathToFileURL(join(import.meta.dir, 'helpers/phase-trace.ts')).href
        await writeFile(join(directory, 'probe.ts'), `
import { traceSync, traceAsync } from ${JSON.stringify(helper)}
import { mkdirSync, unlinkSync } from 'node:fs'
const scenario = ${JSON.stringify(scenario)}
let clock = 0
Object.defineProperty(performance, 'now', { value: () => ++clock })
let calls = 0
const originalError = scenario === 'operation-error-format' ? { toString() { throw new Error('error observation failed') } } : new Error('original operation error')
const value = { get exitCode() {
  if (scenario === 'getter-error' || scenario === 'disabled') throw new Error('observer getter error')
  clock += 1000
  return 0
} }
const details = { get observedDetail() { clock += 1000; return 'metadata' } }
const operation = () => {
  calls++; clock += 10
  if (scenario === 'end-directory') { unlinkSync(process.env.DTSX_TEST_TRACE!); mkdirSync(process.env.DTSX_TEST_TRACE!) }
  if (scenario.startsWith('operation-error')) throw originalError
  return value
}
let sameResult = false
let sameError = false
try {
  const result = ${asynchronous ? 'await traceAsync("probe", async () => operation(), details)' : 'traceSync("probe", operation, details)'}
  sameResult = result === value
} catch (error) { sameError = error === originalError }
if (scenario === 'directory') process.exitCode = 0
console.log(JSON.stringify({ calls, sameResult, sameError }))
`)
        const child = Bun.spawn([process.execPath, '--no-env-file', join(directory, 'probe.ts')], {
          cwd: directory,
          env: { ...process.env, DTSX_TEST_TRACE: scenario === 'disabled' ? undefined : scenario === 'directory' || scenario === 'operation-error' ? directory : destination },
          stdout: 'pipe', stderr: 'pipe',
        })
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
        expect(JSON.parse(stdout)).toEqual({ calls: 1, sameResult: !scenario.startsWith('operation-error'), sameError: scenario.startsWith('operation-error') })
        const failedObservation = ['directory', 'end-directory', 'operation-error', 'operation-error-format', 'getter-error'].includes(scenario)
        expect(code, stderr).toBe(failedObservation ? 1 : 0)
        if (failedObservation) expect(stderr).toContain('DTSX phase observation failed')
        if (scenario === 'timing' || scenario === 'getter-error') {
          const records = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
          expect(records.map(record => record.event)).toEqual(['start', 'end'])
          expect(records[1].operationElapsedMs).toBe(11)
          if (scenario === 'getter-error') expect(records[1].statusObservationError).toContain('observer getter error')
          else expect(records[1].monotonicMs - records[0].monotonicMs).toBeGreaterThan(1000)
        }
      }
      finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
}

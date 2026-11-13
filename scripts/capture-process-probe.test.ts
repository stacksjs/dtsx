import type { ProbeOutcome } from './capture-process-probe'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'bun:test'

let root: string
let moduleUrl: string
const node = Bun.which('node')

beforeAll(async () => {
  expect(node).not.toBeNull()
  root = await mkdtemp(join(tmpdir(), 'dtsx process probe '))
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'capture-process-probe.ts')], target: 'node', format: 'esm' })
  expect(built.success).toBe(true)
  const module = join(root, 'capture.mjs')
  await writeFile(module, new Uint8Array(await built.outputs[0]!.arrayBuffer()))
  moduleUrl = pathToFileURL(module).href
})
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

async function probe(executable: string, args: string[], timeoutBudgetMs = 2000): Promise<ProbeOutcome> {
  const source = `import { captureProcessProbe } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await captureProcessProbe(${JSON.stringify(executable)}, ${JSON.stringify(args)}, ${timeoutBudgetMs})));`
  const child = Bun.spawn([node!, '--input-type=module', '-e', source], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(code).toBe(0)
  expect(stderr).toBe('')
  return JSON.parse(stdout) as ProbeOutcome
}

test('actual Node probes preserve exit status and both completed output streams', async () => {
  const result = await probe(node!, ['-e', "process.stdout.write('probe output'); process.stderr.write('probe error'); process.exitCode = 17"])
  expect(result).toMatchObject({ code: 17, signal: null, stdout: 'probe output', stderr: 'probe error', nodeSentKill: false, timeoutBudgetMs: 2000 })
  expect(result.childPid).toBeGreaterThan(1)
  expect(result.elapsedMs).toBeGreaterThan(0)
  expect(result.processError).toBeUndefined()
})

test('actual Node deadline termination retains the signal, elapsed time and pre-termination output', async () => {
  const result = await probe(node!, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], 1000)
  expect(result).toMatchObject({ code: null, signal: 'SIGTERM', stdout: 'ready\n', stderr: '', nodeSentKill: true, timeoutBudgetMs: 1000 })
  expect(result.elapsedMs).toBeGreaterThanOrEqual(990)
  expect(result.childPid).toBeGreaterThan(1)
  expect(result.processError).toBeUndefined()
})

test('actual Node startup failure is settled on close with its original spawn error', async () => {
  const result = await probe(join(root, 'missing executable'), [])
  expect(result.code).not.toBe(0)
  expect(result).toMatchObject({ signal: null, childPid: null, stdout: '', nodeSentKill: false, timeoutBudgetMs: 2000, processError: { code: 'ENOENT' } })
  expect(result.stderr).toContain(result.processError!.message)
  expect(result.elapsedMs).toBeGreaterThan(0)
})

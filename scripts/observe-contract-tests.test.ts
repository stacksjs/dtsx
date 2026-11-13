import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'bun:test'

let root: string
let observer: string
let completedCases = 0
const node = Bun.which('node')
const traceHelper = pathToFileURL(resolve(import.meta.dir, '../packages/dtsx/test/helpers/phase-trace.ts')).href

function quote(value: string): string { return process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'` }

beforeAll(async () => {
  expect(['darwin', 'win32']).toContain(process.platform)
  expect(node).not.toBeNull()
  const base = resolve(process.env.DTSX_OBSERVER_TEST_EVIDENCE ?? tmpdir())
  await mkdir(base, { recursive: true })
  root = await mkdtemp(join(base, 'dtsx external observer '))
  observer = join(root, 'observer.mjs')
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'observe-contract-tests.ts')], target: 'node', format: 'esm' })
  expect(built.success).toBe(true)
  await writeFile(observer, new Uint8Array(await built.outputs[0]!.arrayBuffer()))
})
afterAll(async () => {
  if (root && completedCases === 4 && !process.env.DTSX_OBSERVER_TEST_EVIDENCE) await rm(root, { recursive: true, force: true })
  else if (root) process.stderr.write(`Observer fidelity evidence: ${root}\n`)
})

async function observe(label: string, exitCode: number, brokenStorage = false, traceOperation = false) {
  const directory = join(root, label)
  await mkdir(directory)
  const marker = join(directory, 'real operation marker')
  const trace = join(directory, 'phases.jsonl')
  const evidence = join(directory, 'evidence')
  if (brokenStorage) await writeFile(evidence, 'owned regular file, not a directory')
  const operation = `await Bun.write(${JSON.stringify(marker)}, 'real operation ran'); console.log('original output');`
  const script = traceOperation
    ? `import { traceAsync } from ${JSON.stringify(traceHelper)}; await traceAsync('observer smoke', async () => { ${operation} await Bun.sleep(2200) });`
    : `${operation} process.exit(${exitCode});`
  const command = `${process.platform === 'win32' ? '& ' : ''}${[process.execPath, '-e', script].map(quote).join(' ')}`
  const commandFile = join(directory, 'command.json')
  await writeFile(commandFile, JSON.stringify(command))
  const child = Bun.spawn([node!, observer, '--command-file', commandFile, '--trace', trace, '--evidence', evidence], {
    cwd: directory, env: { ...process.env, DTSX_TEST_TRACE: trace }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(await readFile(marker, 'utf8')).toBe('real operation ran')
  expect(stdout).toBe('original output\n')
  const summary = JSON.parse(stderr.trim().split('\n').at(-1)!) as { commandExitCode: number, errors: string[], phaseEvents: number }
  return { code, summary, stderr, evidence }
}

test('the independent observer preserves a successful real Bun operation and its phase trace', async () => {
  const result = await observe('normal', 0, false, true)
  expect(result.code, result.stderr).toBe(0)
  expect(result.summary.commandExitCode).toBe(0)
  expect(result.summary.phaseEvents).toBe(2)
  expect(result.summary.errors).toEqual([])
  const events = (await readFile(join(result.evidence, 'observations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string, code?: number, file?: string })
  if (process.platform === 'darwin') {
    const sample = events.find(event => event.event === 'sample' && event.code === 0)
    expect(sample).toBeDefined()
    expect((await readFile(sample!.file!, 'utf8')).length).toBeGreaterThan(0)
  }
  else {
    const snapshots = (await readFile(join(result.evidence, 'observations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string, resources?: Array<{ handles?: number }> })
    expect(snapshots.some(event => event.event === 'windows-process-snapshot' && event.resources?.some(resource => Number(resource.handles) > 0))).toBe(true)
  }
  completedCases++
})

test('the observer preserves the actual command failure', async () => {
  const result = await observe('failure', 17)
  expect(result.code).toBe(17)
  expect(result.summary.commandExitCode).toBe(17)
  completedCases++
})

test('failed observation storage cannot prevent a successful real operation and independently fails collection', async () => {
  const result = await observe('storage-success', 0, true)
  expect(result.code).toBe(1)
  expect(result.summary.commandExitCode).toBe(0)
  expect(result.summary.errors.length).toBeGreaterThan(0)
  completedCases++
})

test('failed observation storage cannot replace the actual command failure', async () => {
  const result = await observe('storage-failure', 17, true)
  expect(result.code).toBe(17)
  expect(result.summary.commandExitCode).toBe(17)
  expect(result.summary.errors.length).toBeGreaterThan(0)
  completedCases++
})

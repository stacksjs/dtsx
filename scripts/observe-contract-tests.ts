/** External Node observer: never changes the observed command or its deadlines. */
import type { WriteStream } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { cpus, freemem, loadavg, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'

interface TraceEvent {
  event: 'start' | 'end'
  id: number
  pid: number
  phase: string
  executable?: string
  bun?: string
}
interface OwnedProcess { pid: number, parent: number, executable: string }

function traceEvent(value: unknown): value is TraceEvent {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (entry.event === 'start' || entry.event === 'end')
    && Number.isSafeInteger(entry.id) && Number.isSafeInteger(entry.pid)
    && Number(entry.pid) > 1 && typeof entry.phase === 'string'
    && (entry.executable === undefined || typeof entry.executable === 'string')
    && (entry.bun === undefined || typeof entry.bun === 'string')
}

async function capture(executable: string, args: string[], timeout = 2000) {
  return new Promise<{ code: number | null, stdout: string, stderr: string }>((fulfill) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', error => fulfill({ code: null, stdout, stderr: `${stderr}\n${error.message}` }))
    child.once('close', code => fulfill({ code, stdout, stderr }))
  })
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: {
    'command-file': { type: 'string' }, trace: { type: 'string' }, evidence: { type: 'string' },
  } })
  if (!values['command-file'] || !values.trace || !values.evidence)
    throw new Error('Supply --command-file, --trace and --evidence')
  const command: unknown = JSON.parse(await readFile(values['command-file'], 'utf8'))
  if (typeof command !== 'string' || !command.trim()) throw new Error('Expected the canonical workflow command')
  const trace = resolve(values.trace), evidence = resolve(values.evidence)
  const errors: string[] = []
  let stream: WriteStream | undefined
  let traceReader: FileHandle | undefined
  let latest: TraceEvent | undefined
  let traceOffset = 0, partial = '', phaseEvents = 0, samples = 0
  let lastTraceAt = performance.now(), lastSampleAt = -Infinity, lastResourcesAt = performance.now()
  let closed = false
  let commandElapsedMs: number | undefined
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.alloc(64 * 1024)
  const pending: Promise<void>[] = []
  const started = performance.now()

  // Start the real operation even if observation storage cannot be created.
  // Match the runner's PowerShell failure/exit handling on Windows.
  const shell = process.platform === 'win32' ? 'pwsh' : '/bin/bash'
  const shellArgs = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'stop'\n${command}\nif ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }`]
    : ['--noprofile', '--norc', '-e', '-c', command]
  const child = spawn(shell, shellArgs, { stdio: 'inherit' })
  const exit = new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((fulfill) => {
    child.once('error', error => { errors.push(`command startup: ${error.message}`); closed = true; commandElapsedMs = performance.now() - started; fulfill({ code: 127, signal: null }) })
    child.once('close', (code, signal) => { closed = true; commandElapsedMs = performance.now() - started; fulfill({ code, signal }) })
  })
  try {
    await mkdir(evidence, { recursive: true })
    stream = createWriteStream(join(evidence, 'observations.jsonl'))
    stream.on('error', error => { errors.push(`observation output: ${error.message}`); stream = undefined })
  }
  catch (error) { errors.push(`observation setup: ${String(error)}`) }
  function record(value: Record<string, unknown>): void {
    try { stream?.write(`${JSON.stringify({ at: new Date().toISOString(), monotonicMs: performance.now(), ...value })}\n`) }
    catch (error) { errors.push(`observation write: ${String(error)}`) }
  }
  record({ event: 'start', command, commandPid: child.pid, observer: process.execPath, node: process.version })
  let previousHeartbeat = performance.now()
  const heartbeat = setInterval(() => {
    const now = performance.now()
    record({ event: 'heartbeat', intervalMs: now - previousHeartbeat, observerCpuMicros: process.cpuUsage(), loadAverage: loadavg(), systemFreeMemoryBytes: freemem() })
    previousHeartbeat = now
  }, 250)

  async function readTrace(): Promise<void> {
    if (!traceReader) {
      try { traceReader = await open(trace, 'r') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
    }
    const begin = performance.now()
    const { bytesRead } = await traceReader.read(buffer, 0, buffer.length, traceOffset)
    traceOffset += bytesRead
    partial += decoder.write(buffer.subarray(0, bytesRead))
    let newline: number
    while ((newline = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, newline)
      partial = partial.slice(newline + 1)
      if (!line) continue
      const entry: unknown = JSON.parse(line)
      if (!traceEvent(entry)) throw new Error('Invalid operation trace event')
      latest = entry
      phaseEvents++
      lastTraceAt = performance.now()
    }
    record({ event: 'trace-read', bytesRead, durationMs: performance.now() - begin, phaseId: latest?.id, phase: latest?.phase, phaseEvent: latest?.event })
  }

  async function snapshot(withStacks = true): Promise<void> {
    if (!child.pid || closed) return
    const phaseAtRequest = latest
    const probeStartedAt = new Date().toISOString()
    if (process.platform === 'win32') {
      const script = `
$ErrorActionPreference = 'Stop'
$rows = @(Get-CimInstance Win32_Process)
$owned = [System.Collections.Generic.HashSet[int]]::new()
[void]$owned.Add(${child.pid})
do {
  $added = $false
  foreach ($row in $rows) {
    if ($owned.Contains([int]$row.ParentProcessId) -and $owned.Add([int]$row.ProcessId)) { $added = $true }
  }
} while ($added)
$actual = @($rows | Where-Object { $owned.Contains([int]$_.ProcessId) })
$parents = @{}
foreach ($row in $actual) { $parents[[int]$row.ParentProcessId] = $true }
$leaf = $actual | Where-Object { -not $parents.ContainsKey([int]$_.ProcessId) } | Select-Object -Last 1
$root = ${phaseAtRequest?.pid ?? child.pid}
if (-not $owned.Contains($root)) { $root = ${child.pid} }
$targets = @($root; if ($leaf) { [int]$leaf.ProcessId }) | Select-Object -Unique
$resources = @(foreach ($target in $targets) {
  try {
    $process = Get-Process -Id $target -ErrorAction Stop
    $threads = @(foreach ($thread in $process.Threads) {
      try {
        $state = [string]$thread.ThreadState
        $wait = if ($state -eq 'Wait') { [string]$thread.WaitReason } else { $null }
        @{ id = $thread.Id; state = $state; waitReason = $wait }
      } catch { @{ id = $thread.Id; probeError = $_.Exception.Message } }
    })
    @{ pid = $target; sampledAt = [DateTimeOffset]::UtcNow.ToString('o'); cpuMilliseconds = $process.TotalProcessorTime.TotalMilliseconds; handles = $process.HandleCount; workingSetBytes = $process.WorkingSet64; threadCount = $process.Threads.Count; threads = $threads }
  } catch { @{ pid = $target; probeError = $_.Exception.Message; targetExited = ([string]$_.CategoryInfo.Category -eq 'ObjectNotFound') } }
})
@{ rootPid = $root; processes = @($actual | ForEach-Object { @{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; executable = if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name } } }); resources = $resources } | ConvertTo-Json -Depth 8 -Compress
`
      const begin = performance.now()
      const result = await capture('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], 4000)
      if (result.code !== 0) {
        if (!closed) throw new Error(`Windows process observation: ${result.stderr}`)
        record({ event: 'late-snapshot-error', phaseAtRequest, probeStartedAt, ...result })
        return
      }
      const probe = JSON.parse(result.stdout) as { rootPid: number, processes: OwnedProcess[], resources: Array<{ pid: number, probeError?: string, targetExited?: boolean, threads?: Array<{ probeError?: string }> }> }
      if (!Number.isSafeInteger(probe.rootPid) || !Array.isArray(probe.processes) || !Array.isArray(probe.resources)) throw new Error('Invalid Windows observation output')
      record({ event: 'windows-process-snapshot', trigger: withStacks ? 'trace-gap' : 'resources', phaseAtRequest, phaseAtResponse: latest, probeStartedAt, probeElapsedMs: performance.now() - begin, ...probe, stackSampling: 'Thread wait-state metadata only; no Windows stack trace is collected.' })
      const rootResource = probe.resources.find(resource => resource.pid === probe.rootPid)
      if (rootResource?.probeError && !rootResource.targetExited && !closed) errors.push(`Windows root observation: ${rootResource.probeError}`)
      if (rootResource?.threads?.length && rootResource.threads.every(thread => thread.probeError) && !closed) errors.push('No Windows root thread states were readable')
      return
    }
    if (process.platform !== 'darwin') return
    const table = await capture('/bin/ps', ['-axo', 'pid=,ppid=,comm='])
    if (table.code !== 0) throw new Error(`process inventory: ${table.stderr}`)
    const processes: OwnedProcess[] = table.stdout.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), executable: match[3]! }] : []
    })
    const owned = new Set([child.pid])
    for (let added = true; added; ) {
      added = false
      for (const entry of processes) if (owned.has(entry.parent) && !owned.has(entry.pid)) { owned.add(entry.pid); added = true }
    }
    const actual = processes.filter(entry => owned.has(entry.pid))
    const root = latest && owned.has(latest.pid) ? latest.pid : child.pid
    const leaf = actual.findLast(entry => !actual.some(other => other.parent === entry.pid))?.pid
    const targets = [...new Set([root, leaf].filter((pid): pid is number => pid !== undefined && actual.some(entry => entry.pid === pid)))]
    record({ event: 'process-tree', phase: latest, processes: actual })
    for (const pid of targets) {
      const [status, descriptors] = await Promise.all([
        capture('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,stat=,time=,rss=,vsz=']),
        capture('/usr/sbin/lsof', ['-b', '-nP', '-p', String(pid), '-Ff']),
      ])
      record({ event: 'resources', pid, phaseId: latest?.id, status: status.stdout, openDescriptors: descriptors.code === 0 ? descriptors.stdout.split('\n').filter(line => /^f\d+$/.test(line)).length : null, descriptorStatus: descriptors.code })
      if (status.code !== 0) { record({ event: 'target-exited-before-sample', pid }); continue }
      if (descriptors.code !== 0) {
        const alive = await capture('/bin/ps', ['-p', String(pid), '-o', 'pid='])
        if (alive.code === 0) errors.push(`file descriptor observation ${pid}: ${descriptors.stderr}`)
      }
      if (!withStacks) continue
      const file = join(evidence, `sample-${samples}-${pid}.txt`)
      const sampled = await capture('/usr/bin/sample', [String(pid), '1', '20', '-mayDie', '-file', file], 4000)
      record({ event: 'sample', pid, phaseId: latest?.id, file, ...sampled })
      if (sampled.code !== 0 && !closed) {
        const alive = await capture('/bin/ps', ['-p', String(pid), '-o', 'pid='])
        if (alive.code === 0) errors.push(`sample ${pid}: ${sampled.stderr}`)
      }
    }
  }

  record({ event: 'host-runtime', platform: process.platform, release: release(), cpus: cpus().length, totalMemoryBytes: totalmem() })
  if (process.platform !== 'win32') {
    const inheritedLimit = await capture('/bin/bash', ['--noprofile', '--norc', '-c', 'ulimit -n'])
    record({ event: 'inherited-file-limit', ...inheritedLimit })
  }
  if (process.platform === 'darwin') record({ event: 'host', ...await capture('/usr/sbin/sysctl', ['hw.model', 'hw.ncpu', 'hw.memsize', 'kern.maxfilesperproc']) })
  pending.push(snapshot(false).catch(error => { errors.push(`initial process snapshot: ${String(error)}`) }))

  while (!closed) {
    try { await readTrace() }
    catch (error) { errors.push(`operation trace: ${String(error)}`) }
    const now = performance.now()
    // Observation limits never stop or change the tested operation.
    if (now - lastTraceAt > 750 && now - lastSampleAt > 10_000 && samples < 256) {
      lastSampleAt = now
      samples++
      lastResourcesAt = now
      pending.push(snapshot().catch(error => { errors.push(`process snapshot: ${String(error)}`) }))
    }
    else if (now - lastResourcesAt > 30_000) {
      lastResourcesAt = now
      pending.push(snapshot(false).catch(error => { errors.push(`periodic resources: ${String(error)}`) }))
    }
    await delay(250)
  }
  clearInterval(heartbeat)
  const outcome = await exit
  await Promise.all(pending)
  try { do { const before = traceOffset; await readTrace(); if (traceOffset === before) break } while (true) }
  catch (error) { errors.push(`final operation trace: ${String(error)}`) }
  await traceReader?.close().catch(error => { errors.push(`trace close: ${String(error)}`) })
  if (partial.trim()) errors.push('Incomplete final operation trace event')
  if (outcome.code === 0 && phaseEvents === 0) errors.push('No operation trace events collected')
  let testedRuntime: { bun?: string, executable: string, sha256: string } | undefined
  if (latest?.executable) {
    try { testedRuntime = { bun: latest.bun, executable: latest.executable, sha256: await hashFile(latest.executable) } }
    catch (error) { errors.push(`tested runtime identity: ${String(error)}`) }
  }
  const summary = {
    command, commandExitCode: outcome.code, commandSignal: outcome.signal, commandElapsedMs, collectionElapsedMs: performance.now() - started,
    observer: { executable: process.execPath, node: process.version }, testedRuntime, phaseEvents, snapshotAttempts: samples, errors,
    scope: 'Diagnostic observations only. Original command, providers, fixtures and per-test deadlines are unchanged.',
  }
  record({ event: 'end', ...summary })
  try {
    if (stream) { stream.end(); await finished(stream) }
    await writeFile(join(evidence, 'summary.json'), `${JSON.stringify({ ...summary, traceSha256: phaseEvents ? await hashFile(trace) : null }, null, 2)}\n`)
  }
  catch (error) { errors.push(`observation finalization: ${String(error)}`) }
  process.stderr.write(`${JSON.stringify(summary)}\n`)
  // An observer failure cannot hide or replace the real command's failure.
  if (outcome.signal) process.kill(process.pid, outcome.signal)
  return outcome.code === 0 ? errors.length ? 1 : 0 : outcome.code ?? 1
}

process.exitCode = await main()

import { appendFileSync } from 'node:fs'
import { freemem } from 'node:os'

const destination = process.env.DTSX_TEST_TRACE
let sequence = 0
let observationFailed = false

function observationFailure(error: unknown): void {
  if (observationFailed) return
  observationFailed = true
  // Fail the diagnostic gate without replacing a real operation's result/error.
  // The exit hook also preserves this failure if subsequent tests reset exitCode.
  if (!process.exitCode) process.exitCode = 1
  process.once('exit', () => { if (!process.exitCode) process.exitCode = 1 })
  try { console.error('DTSX phase observation failed:', error) }
  catch { /* A closed stderr must not interfere with the observed operation. */ }
}

function resources(): Record<string, unknown> {
  try {
    return { selfCpuMicros: process.cpuUsage(), selfRSSBytes: process.memoryUsage.rss(), systemFreeMemoryBytes: freemem() }
  }
  catch (error) {
    observationFailure(error)
    return { resourceObservationError: describe(error) }
  }
}

function record(event: string, id: number, phase: string, details: Record<string, unknown>): void {
  try {
    appendFileSync(destination!, `${JSON.stringify({ event, id, phase, pid: process.pid, bun: Bun.version, executable: process.execPath, monotonicMs: performance.now(), at: new Date().toISOString(), ...resources(), ...details })}\n`, { mode: 0o600 })
  }
  catch (error) { observationFailure(error) }
}

function status(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, unknown> = {}
  for (const field of ['exitCode', 'signalCode', 'success', 'exitedDueToTimeout', 'exitedDueToMaxBuffer'] as const) {
    if (field in value) result[field] = Reflect.get(value, field)
  }
  if ('pid' in value) result.childPid = value.pid
  // Bun's synchronous subprocess resource fields are non-enumerable getters.
  // Copy the documented counters explicitly, without changing the operation.
  if ('resourceUsage' in value) {
    try {
      const usage = value.resourceUsage as Bun.ResourceUsage
      if (usage && typeof usage === 'object') {
        result.childResources = {
          cpuMicros: { user: Number(usage.cpuTime.user), system: Number(usage.cpuTime.system) },
          maxRSSBytes: usage.maxRSS,
          contextSwitches: { voluntary: usage.contextSwitches.voluntary, involuntary: usage.contextSwitches.involuntary },
        }
      }
    }
    catch (error) {
      observationFailure(error)
      result.childResourceObservationError = describe(error)
    }
  }
  return result
}

function describe(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch (observationError) {
    observationFailure(observationError)
    return 'Unable to describe observed error'
  }
}

function completion(details: Record<string, unknown>, value: unknown, operationElapsedMs: number): Record<string, unknown> {
  try { return { ...details, ...status(value), operationElapsedMs } }
  catch (error) {
    observationFailure(error)
    return { operationElapsedMs, statusObservationError: describe(error) }
  }
}

function failure(details: Record<string, unknown>, error: unknown, operationElapsedMs: number): Record<string, unknown> {
  try { return { ...details, operationElapsedMs, error: describe(error) } }
  catch (observationError) {
    observationFailure(observationError)
    return { operationElapsedMs, error: describe(error), detailsObservationError: describe(observationError) }
  }
}

/** Preserve the real operation and guards; observation failure independently fails the process. */
export function traceSync<T>(phase: string, operation: () => T, details: Record<string, unknown> = {}): T {
  if (!destination) return operation()
  const id = ++sequence
  record('start', id, phase, details)
  const started = performance.now()
  let value: T
  try {
    value = operation()
  }
  catch (error) {
    const operationElapsedMs = performance.now() - started
    record('error', id, phase, failure(details, error, operationElapsedMs))
    throw error
  }
  const operationElapsedMs = performance.now() - started
  record('end', id, phase, completion(details, value, operationElapsedMs))
  return value
}

export async function traceAsync<T>(phase: string, operation: () => Promise<T>, details: Record<string, unknown> = {}): Promise<T> {
  if (!destination) return operation()
  const id = ++sequence
  record('start', id, phase, details)
  const started = performance.now()
  let value: T
  try {
    value = await operation()
  }
  catch (error) {
    const operationElapsedMs = performance.now() - started
    record('error', id, phase, failure(details, error, operationElapsedMs))
    throw error
  }
  const operationElapsedMs = performance.now() - started
  record('end', id, phase, completion(details, value, operationElapsedMs))
  return value
}

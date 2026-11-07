import { appendFileSync } from 'node:fs'

const destination = process.env.DTSX_TEST_TRACE
let sequence = 0

function record(event: string, id: number, phase: string, details: Record<string, unknown>): void {
  appendFileSync(destination!, `${JSON.stringify({ event, id, phase, pid: process.pid, bun: Bun.version, executable: process.execPath, monotonicMs: performance.now(), at: new Date().toISOString(), ...details })}\n`, { mode: 0o600 })
}

function status(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, unknown> = {}
  for (const field of ['exitCode', 'signalCode', 'success'] as const) {
    if (field in value) result[field] = Reflect.get(value, field)
  }
  return result
}

/** Optional observation only: call the same real operation, preserving its result/error and guards. */
export function traceSync<T>(phase: string, operation: () => T, details: Record<string, unknown> = {}): T {
  if (!destination) return operation()
  const id = ++sequence
  record('start', id, phase, details)
  try {
    const value = operation()
    record('end', id, phase, { ...details, ...status(value) })
    return value
  }
  catch (error) {
    record('error', id, phase, { ...details, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function traceAsync<T>(phase: string, operation: () => Promise<T>, details: Record<string, unknown> = {}): Promise<T> {
  if (!destination) return operation()
  const id = ++sequence
  record('start', id, phase, details)
  try {
    const value = await operation()
    record('end', id, phase, { ...details, ...status(value) })
    return value
  }
  catch (error) {
    record('error', id, phase, { ...details, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

import { spawn } from 'node:child_process'

/** The observed outcome of a diagnostic subprocess, independent of the real command. */
export interface ProbeOutcome {
  code: number | null
  signal: NodeJS.Signals | null
  childPid: number | null
  stdout: string
  stderr: string
  elapsedMs: number
  timeoutBudgetMs: number
  nodeSentKill: boolean
  processError?: { message: string, code?: string }
}

/** Preserve output through close, including spawn errors and Node's deadline termination. */
export async function captureProcessProbe(executable: string, args: string[], timeoutBudgetMs = 2000): Promise<ProbeOutcome> {
  const started = performance.now()
  return new Promise((fulfill) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutBudgetMs })
    let stdout = '', stderr = ''
    let processError: ProbeOutcome['processError']
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', (error: NodeJS.ErrnoException) => {
      processError = { message: error.message, code: error.code }
      stderr += `\n${error.message}`
    })
    child.once('close', (code, signal) => fulfill({
      code, signal, childPid: child.pid ?? null, stdout, stderr,
      elapsedMs: performance.now() - started, timeoutBudgetMs,
      nodeSentKill: child.killed, ...(processError ? { processError } : {}),
    }))
  })
}

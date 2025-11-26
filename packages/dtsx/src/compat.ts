/**
 * Runtime Compatibility Layer
 *
 * Provides cross-runtime compatibility for Bun and Node.js
 * Automatically detects the runtime and uses the appropriate APIs
 */

import { readFile, stat, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/**
 * Runtime detection
 */
export const isBun = typeof globalThis.Bun !== 'undefined'
export const isNode = !isBun && typeof process !== 'undefined' && process.versions?.node

/**
 * Current runtime name
 */
export const runtime: 'bun' | 'node' = isBun ? 'bun' : 'node'

/**
 * File handle interface compatible with Bun.file()
 */
export interface FileHandle {
  /** Check if file exists */
  exists(): Promise<boolean>
  /** Read file as text */
  text(): Promise<string>
  /** Read file as ArrayBuffer */
  arrayBuffer(): Promise<ArrayBuffer>
  /** Get file size */
  size: number
  /** File path */
  name: string
}

/**
 * Spawn result interface compatible with Bun.spawn()
 */
export interface SpawnResult {
  /** Process ID */
  pid: number
  /** Standard output stream */
  stdout: ReadableStream<Uint8Array> | NodeJS.ReadableStream
  /** Standard error stream */
  stderr: ReadableStream<Uint8Array> | NodeJS.ReadableStream
  /** Standard input stream */
  stdin: WritableStream<Uint8Array> | NodeJS.WritableStream | null
  /** Exit code promise */
  exited: Promise<number>
  /** Kill the process */
  kill(signal?: number): void
  /** Reference to underlying process */
  ref(): void
  /** Unreference the process */
  unref(): void
}

/**
 * Node.js implementation of Bun-like file handle
 */
class NodeFileHandle implements FileHandle {
  name: string
  private _size: number = -1

  constructor(path: string) {
    this.name = path
  }

  async exists(): Promise<boolean> {
    try {
      await stat(this.name)
      return true
    }
    catch {
      return false
    }
  }

  async text(): Promise<string> {
    return readFile(this.name, 'utf-8')
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const buffer = await readFile(this.name)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }

  get size(): number {
    if (this._size === -1) {
      // Return -1 if not yet loaded; caller should use exists() first
      return -1
    }
    return this._size
  }
}

/**
 * Node.js implementation of Bun-like spawn result
 */
class NodeSpawnResult implements SpawnResult {
  pid: number
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  stdin: NodeJS.WritableStream | null
  exited: Promise<number>
  private process: ChildProcess

  constructor(proc: ChildProcess) {
    this.process = proc
    this.pid = proc.pid ?? 0
    this.stdout = proc.stdout as NodeJS.ReadableStream
    this.stderr = proc.stderr as NodeJS.ReadableStream
    this.stdin = proc.stdin

    this.exited = new Promise((resolve) => {
      proc.on('exit', (code) => {
        resolve(code ?? 0)
      })
      proc.on('error', () => {
        resolve(1)
      })
    })
  }

  kill(signal?: number): void {
    this.process.kill(signal as NodeJS.Signals | undefined)
  }

  ref(): void {
    this.process.ref()
  }

  unref(): void {
    this.process.unref()
  }
}

/**
 * Cross-runtime file handle creator
 * Compatible with Bun.file() API
 */
export function file(path: string): FileHandle {
  if (isBun) {
    return (globalThis as any).Bun.file(path)
  }
  return new NodeFileHandle(path)
}

/**
 * Cross-runtime file writer
 * Compatible with Bun.write() API
 */
export async function write(path: string, content: string | Uint8Array | ArrayBuffer): Promise<number> {
  if (isBun) {
    return (globalThis as any).Bun.write(path, content)
  }

  const data = typeof content === 'string'
    ? content
    : content instanceof ArrayBuffer
      ? Buffer.from(content)
      : content

  await writeFile(path, data)
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
}

/**
 * Spawn options compatible with Bun.spawn()
 */
export interface CompatSpawnOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  stdin?: 'inherit' | 'pipe' | 'ignore' | null
  stdout?: 'inherit' | 'pipe' | 'ignore' | null
  stderr?: 'inherit' | 'pipe' | 'ignore' | null
}

/**
 * Cross-runtime process spawner
 * Compatible with Bun.spawn() API
 */
export function spawnProcess(
  command: string | string[],
  options: CompatSpawnOptions = {},
): SpawnResult {
  if (isBun) {
    return (globalThis as any).Bun.spawn(command, options)
  }

  // Node.js implementation
  const cmd = Array.isArray(command) ? command : [command]
  const [executable, ...args] = cmd

  const nodeOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: [
      options.stdin ?? 'pipe',
      options.stdout ?? 'pipe',
      options.stderr ?? 'pipe',
    ],
  }

  const proc = spawn(executable, args, nodeOptions)
  return new NodeSpawnResult(proc)
}

/**
 * Read a file as text with cross-runtime compatibility
 */
export async function readTextFile(path: string): Promise<string> {
  const handle = file(path)
  return handle.text()
}

/**
 * Check if a file exists with cross-runtime compatibility
 */
export async function fileExists(path: string): Promise<boolean> {
  const handle = file(path)
  return handle.exists()
}

/**
 * Write text to a file with cross-runtime compatibility
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await write(path, content)
}

/**
 * Runtime information
 */
export interface RuntimeInfo {
  name: 'bun' | 'node'
  version: string
  isBun: boolean
  isNode: boolean
}

/**
 * Get runtime information
 */
export function getRuntimeInfo(): RuntimeInfo {
  if (isBun) {
    return {
      name: 'bun',
      version: (globalThis as any).Bun.version,
      isBun: true,
      isNode: false,
    }
  }

  return {
    name: 'node',
    version: process.versions.node,
    isBun: false,
    isNode: true,
  }
}

/**
 * Namespace export for drop-in Bun API replacement
 */
export const compat = {
  file,
  write,
  spawn: spawnProcess,
  readTextFile,
  writeTextFile,
  fileExists,
  getRuntimeInfo,
  runtime,
  isBun,
  isNode,
}

export default compat

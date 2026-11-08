/**
 * TypeScript wrapper for the Zig DTS emitter using Bun FFI.
 */
import type { Pointer } from 'bun:ffi'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { dlopen, FFIType, ptr, suffix, toArrayBuffer } from 'bun:ffi'

const LIB_NAME = `libzig-dtsx.${suffix}`
// On Windows, Zig produces `zig-dtsx.dll` (no `lib` prefix); other platforms keep `libzig-dtsx.{so,dylib}`.
const LIB_NAME_ALT = suffix === 'dll' ? `zig-dtsx.${suffix}` : LIB_NAME

function platformSlug(): string | null {
  const p = platform()
  const a = arch()
  if (p === 'darwin' && a === 'arm64')
    return 'darwin-arm64'
  if (p === 'darwin' && a === 'x64')
    return 'darwin-x64'
  if (p === 'linux' && a === 'arm64')
    return 'linux-arm64'
  if (p === 'linux' && a === 'x64')
    return 'linux-x64'
  if (p === 'win32' && a === 'x64')
    return 'windows-x64'
  if (p === 'freebsd' && a === 'x64')
    return 'freebsd-x64'
  return null
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const outLenBuffer = new BigUint64Array(1)
const outLenBufferIsolated = new BigUint64Array(1)
// Reused out-parameters for the checked entrypoint (calls are synchronous).
const checkedLength = new BigUint64Array(1)
const checkedStatus = new Uint32Array(1)

// Pre-allocated input buffer for encodeInto(); grows only when needed.
// Avoids per-call Uint8Array allocation from encoder.encode().
let inputBuf = new Uint8Array(4 * 1024 * 1024) // 4 MB initial

// Try the local build first so repository tests exercise the current Zig source.
// Published packages do not contain zig-out, so they naturally fall through to
// the platform-specific prebuilt library shipped by the release workflow.
const slug = platformSlug()
const libPaths: string[] = []
libPaths.push(join(import.meta.dir, '..', 'zig-out', 'lib', LIB_NAME))
libPaths.push(join(import.meta.dir, '..', 'zig-out', 'bin', LIB_NAME_ALT))
if (slug !== null) {
  libPaths.push(join(import.meta.dir, '..', 'prebuilt', slug, LIB_NAME))
  libPaths.push(join(import.meta.dir, '..', 'prebuilt', slug, LIB_NAME_ALT))
}

let lib: ReturnType<typeof dlopen> | null = null
let selectedLibPath: string | undefined
for (const libPath of libPaths) {
  try {
    lib = dlopen(libPath, {
      process_source: {
        args: [FFIType.ptr, FFIType.u64, FFIType.bool],
        returns: FFIType.ptr,
      },
      process_source_with_len: {
        args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.ptr],
        returns: FFIType.ptr,
      },
      process_source_with_options: {
        args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool],
        returns: FFIType.ptr,
      },
      process_source_with_options_len: {
        args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool, FFIType.ptr],
        returns: FFIType.ptr,
      },
      result_length: {
        args: [FFIType.ptr],
        returns: FFIType.u64,
      },
      free_result: {
        args: [FFIType.ptr, FFIType.u64],
        returns: FFIType.void,
      },
      process_batch: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.bool, FFIType.ptr, FFIType.ptr, FFIType.u32],
        returns: FFIType.void,
      },
      free_batch_results: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
        returns: FFIType.void,
      },
    })
    selectedLibPath = libPath
    break
  }
  catch {
    continue
  }
}

// Probe the additive ABI on the exact library selected above. Older libraries
// remain usable for preserve APIs and never masquerade as contextual emitters.
const contextABI = {
  process_source_with_context_v1: {
    args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
} as const
let contextLib: ReturnType<typeof dlopen<typeof contextABI>> | null = null
if (selectedLibPath) {
  try { contextLib = dlopen(selectedLibPath, contextABI) }
  catch { /* The legacy source-only ABI is independently available. */ }
}

const checkedABI = {
  process_source_checked_v1: {
    args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
} as const
const checkedBatchABI = {
  process_batch_checked_v1: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.bool, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.void,
  },
} as const
let checkedLib: ReturnType<typeof dlopen<typeof checkedABI>> | null = null
let checkedBatchLib: ReturnType<typeof dlopen<typeof checkedBatchABI>> | null = null
if (selectedLibPath) {
  try { checkedLib = dlopen(selectedLibPath, checkedABI) }
  catch { /* Older selected libraries retain their legacy unchecked contract. */ }
  try { checkedBatchLib = dlopen(selectedLibPath, checkedBatchABI) }
  catch { /* Source-level checked emission remains independently available. */ }
}

const symbols = lib?.symbols as any
const {
  process_source,
  process_source_with_len,
  process_source_with_options,
  process_source_with_options_len,
  result_length,
  free_result,
  process_batch: _process_batch,
  free_batch_results: _free_batch_results,
} = symbols ?? {}

function readResult(resultPtr: ReturnType<typeof process_source>, knownLen?: number): string {
  if (!resultPtr) {
    return ''
  }

  const len = knownLen ?? Number(result_length(resultPtr))
  if (len === 0) {
    free_result(resultPtr, 0)
    return ''
  }

  const buf = toArrayBuffer(resultPtr, 0, len)
  const result = decoder.decode(buf)

  free_result(resultPtr, len)

  return result
}

/**
 * Process TypeScript source code and generate .d.ts declarations.
 *
 * @param sourceCode - The TypeScript source code to process
 * @param keepComments - Whether to preserve comments in output (default: true)
 * @param isolatedDeclarations - Skip initializer parsing when explicit type annotations exist (default: false)
 * @returns The generated .d.ts declaration content
 */
export const ZIG_AVAILABLE: boolean = !!lib
export const ZIG_CONTEXT_AVAILABLE: boolean = !!contextLib
/** Whether the selected library distinguishes emission failures from valid empty output. */
export const ZIG_CHECKED_AVAILABLE: boolean = !!checkedLib
export const ZIG_CHECKED_BATCH_AVAILABLE: boolean = !!checkedBatchLib

function emissionError(status: number, contextual: boolean = false): Error {
  if (status === 5) return Object.assign(new Error('Cannot infer alias: unsupported source value flow'), { code: 'DTSX_UNSUPPORTED_VALUE_FLOW' })
  const messages: Record<number, string> = {
    1: 'Invalid native emission context',
    2: 'Unsupported native emission context version',
    3: 'Unresolved module specifier in native emission context',
    4: contextual ? 'Native contextual declaration emission failed' : 'Native declaration emission failed',
  }
  return new Error(messages[status] ?? `Native declaration emission failed with status ${status}`)
}

/** Resolved graph information supplied by the owning project planner. */
export interface SourceEmissionContext {
  version: 1
  moduleSpecifierMode: 'preserve' | 'node'
  sourceFile: string
  outputFile: string
  /** SHA-256 of the exact UTF-8 source bytes. */
  sourceHash: string
  /** Resolved authored dependency snapshots for native monomorphic-call inference. */
  inferenceSources?: Array<{ specifier: string, source: string }>
  /** Original imports required by the owning project's augmentation graph. */
  augmentationImports?: string[]
  rewrites: Array<{
    specifier: string
    resolvedSource: string
    declarationOutput: string
    emittedSpecifier: string
  }>
}

/**
 * Emit through the native contextual ABI. The caller's planner owns resolution
 * and package delivery; identity strings alone do not prove filesystem ownership.
 * This never falls back to the source-only ABI or a TypeScript emitter.
 */
export function processSourceWithContext(sourceCode: string, context: SourceEmissionContext, keepComments: boolean = true, isolatedDeclarations: boolean = false): string {
  if (!contextLib) throw new Error('Native contextual emission is unavailable in the selected zig-dtsx library; build a library with context ABI v1')
  const encodedSource = encoder.encode(sourceCode)
  const sourceBytes = encodedSource.length ? encodedSource : new Uint8Array(1)
  const serializedContext = JSON.stringify(context)
  if (typeof serializedContext !== 'string') throw new Error('Invalid native emission context')
  const contextBytes = encoder.encode(serializedContext)
  const length = new BigUint64Array(1)
  const status = new Uint32Array(1)
  const result = contextLib.symbols.process_source_with_context_v1(
    ptr(sourceBytes), encodedSource.length, keepComments, isolatedDeclarations,
    ptr(contextBytes), contextBytes.length, ptr(length), ptr(status),
  )
  if (status[0] !== 0) {
    if (result) free_result(result, Number(length[0]))
    throw emissionError(status[0], true)
  }
  return readResult(result, Number(length[0]))
}

export function processSource(sourceCode: string, keepComments: boolean = true, isolatedDeclarations: boolean = false): string {
  if (!lib) {
    throw new Error(
      `zig-dtsx shared library not found. Run 'zig build -Doptimize=fast' first.`,
    )
  }
  if (!sourceCode || sourceCode.length === 0) {
    return ''
  }

  // Encode into pre-allocated buffer (grow if needed). Avoids a new Uint8Array per call.
  const maxBytes = sourceCode.length * 3 // UTF-8 worst case
  if (maxBytes > inputBuf.length) {
    inputBuf = new Uint8Array(maxBytes)
  }
  const { written } = encoder.encodeInto(sourceCode, inputBuf)

  if (checkedLib) {
    const result = checkedLib.symbols.process_source_checked_v1(ptr(inputBuf), written, keepComments, isolatedDeclarations, ptr(checkedLength), ptr(checkedStatus))
    const length = Number(checkedLength[0])
    if (checkedStatus[0] !== 0) {
      if (result) free_result(result, length)
      throw emissionError(checkedStatus[0])
    }
    return readResult(result, length)
  }

  if (isolatedDeclarations) {
    if (process_source_with_options_len) {
      const resultPtr = process_source_with_options_len(ptr(inputBuf), written, keepComments, true, ptr(outLenBufferIsolated))
      return readResult(resultPtr, Number(outLenBufferIsolated[0]))
    }

    const resultPtr = process_source_with_options(ptr(inputBuf), written, keepComments, true)
    return readResult(resultPtr)
  }

  if (process_source_with_len) {
    const resultPtr = process_source_with_len(ptr(inputBuf), written, keepComments, ptr(outLenBuffer))
    return readResult(resultPtr, Number(outLenBuffer[0]))
  }

  const resultPtr = process_source(ptr(inputBuf), written, keepComments)
  return readResult(resultPtr)
}

/**
 * Process multiple TypeScript source files in parallel.
 * Uses Zig threads for true parallelism — faster than sequential processSource calls.
 *
 * @param sources - Array of TypeScript source code strings
 * @param keepComments - Whether to preserve comments in output (default: true)
 * @param threadCount - Number of worker threads (0 = auto-detect CPU count)
 * @returns Array of generated .d.ts declaration strings
 */
export function processBatch(sources: string[], keepComments: boolean = true, threadCount: number = 0): string[] {
  if (!lib) {
    throw new Error(
      `zig-dtsx shared library not found. Run 'zig build -Doptimize=fast' first.`,
    )
  }
  const count = sources.length
  if (count === 0) return []
  if (checkedLib && !checkedBatchLib) {
    throw new Error('Checked native batch emission is unavailable in the selected zig-dtsx library; build a library with checked batch ABI v1')
  }

  // Encode all sources into separate buffers and collect pointers
  const encodedBuffers: Uint8Array[] = new Array(count)
  const encodedLens: number[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const src = sources[i]
    if (!src || src.length === 0) {
      encodedBuffers[i] = new Uint8Array(1)
      encodedLens[i] = 0
    }
    else {
      const buf = new Uint8Array(src.length * 3)
      const { written } = encoder.encodeInto(src, buf)
      encodedBuffers[i] = buf
      encodedLens[i] = written
    }
  }

  // Build pointer array (array of pointers to input buffers)
  const inputPtrsArray = new BigUint64Array(count)
  const inputLensArray = new BigUint64Array(count)
  for (let i = 0; i < count; i++) {
    inputPtrsArray[i] = BigInt(ptr(encodedBuffers[i]))
    inputLensArray[i] = BigInt(encodedLens[i])
  }

  // Allocate output arrays
  const outPtrsArray = new BigUint64Array(count)
  const outLensArray = new BigUint64Array(count)
  const outStatuses = new Uint32Array(count)

  // Call batch API
  if (checkedBatchLib) {
    checkedBatchLib.symbols.process_batch_checked_v1(
      ptr(inputPtrsArray), ptr(inputLensArray), count, keepComments,
      ptr(outPtrsArray), ptr(outLensArray), threadCount, ptr(outStatuses),
    )
  }
  else {
    _process_batch(ptr(inputPtrsArray), ptr(inputLensArray), count, keepComments, ptr(outPtrsArray), ptr(outLensArray), threadCount)
  }

  // Read results
  try {
    const results: string[] = new Array(count)
    for (let i = 0; i < count; i++) {
      if (outStatuses[i] !== 0) throw emissionError(outStatuses[i])
      const resultPtr = Number(outPtrsArray[i])
      const resultLen = Number(outLensArray[i])
      if (resultLen === 0) results[i] = ''
      else results[i] = decoder.decode(toArrayBuffer(resultPtr as Pointer, 0, resultLen))
    }
    return results
  }
  finally {
    _free_batch_results(ptr(outPtrsArray), ptr(outLensArray), count)
  }
}

export default { processSource, processBatch, processSourceWithContext } as { processSource: typeof processSource, processBatch: typeof processBatch, processSourceWithContext: typeof processSourceWithContext }

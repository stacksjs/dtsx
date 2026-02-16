/**
 * TypeScript wrapper for the Zig DTS emitter using Bun FFI.
 */
import { dlopen, FFIType, ptr, suffix, toArrayBuffer } from 'bun:ffi'
import { join } from 'node:path'

const LIB_NAME = `libzig-dtsx.${suffix}`
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const outLenBuffer = new BigUint64Array(1)
const outLenBufferIsolated = new BigUint64Array(1)

// Pre-allocated input buffer for encodeInto(); grows only when needed.
// Avoids per-call Uint8Array allocation from encoder.encode().
let inputBuf = new Uint8Array(4 * 1024 * 1024) // 4 MB initial

// Try to find the shared library
const libPaths = [
  join(import.meta.dir, '..', 'zig-out', 'lib', LIB_NAME),
  join(import.meta.dir, '..', `zig-out/lib/${LIB_NAME}`),
]

let lib: ReturnType<typeof dlopen> | null = null
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
    })
    break
  }
  catch {
    continue
  }
}

const symbols = lib?.symbols as any
const {
  process_source,
  process_source_with_len,
  process_source_with_options,
  process_source_with_options_len,
  result_length,
  free_result,
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

export function processSource(sourceCode: string, keepComments: boolean = true, isolatedDeclarations: boolean = false): string {
  if (!lib) {
    throw new Error(
      `zig-dtsx shared library not found. Run 'zig build -Doptimize=ReleaseFast' first.`,
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

export default { processSource } as { processSource: typeof processSource }

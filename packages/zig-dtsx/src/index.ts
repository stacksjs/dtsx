/**
 * TypeScript wrapper for the Zig DTS emitter using Bun FFI.
 */
import { dlopen, FFIType, ptr, read, suffix, toArrayBuffer } from 'bun:ffi'
import { join } from 'node:path'

const LIB_NAME = `libzig-dtsx.${suffix}`

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
      process_source_with_options: {
        args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool],
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
const { process_source, process_source_with_options, result_length, free_result } = symbols ?? {}

function readResult(resultPtr: ReturnType<typeof process_source>): string {
  if (!resultPtr) {
    return ''
  }

  const len = Number(result_length(resultPtr))
  if (len === 0) {
    free_result(resultPtr, 0)
    return ''
  }

  const buf = toArrayBuffer(resultPtr, 0, len)
  const decoder = new TextDecoder()
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

  const encoder = new TextEncoder()
  const encoded = encoder.encode(sourceCode)

  const resultPtr = isolatedDeclarations
    ? process_source_with_options(ptr(encoded), encoded.length, keepComments, true)
    : process_source(ptr(encoded), encoded.length, keepComments)

  return readResult(resultPtr)
}

export default { processSource } as { processSource: typeof processSource }

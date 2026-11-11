/**
 * The native declaration engine, loaded in-process through Bun FFI.
 *
 * `@dtsx/dtsx` ships the native library for each platform under
 * `native/<platform>/`. When it loads, declaration emission runs natively;
 * otherwise (unsupported platform, non-Bun runtime) callers use the
 * TypeScript engine. Any native failure also returns `null`, so the
 * TypeScript engine decides how unusual input is reported.
 *
 * The TypeScript engine stays selectable on purpose, as the reference the
 * native engine is compared with: the `engine` option, the CLI's `--engine`
 * flag, or `DTSX_ENGINE=typescript`.
 */
import process from 'node:process'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { fileURLToPath } from 'node:url'

interface NativeLibrary {
  checked: (source: Uint8Array, length: number, keepComments: boolean, isolated: boolean, outLength: BigUint64Array, outStatus: Uint32Array) => unknown
  contextual: (source: Uint8Array, length: number, keepComments: boolean, isolated: boolean, context: Uint8Array, contextLength: number, outLength: BigUint64Array, outStatus: Uint32Array) => unknown
  read: (result: unknown, length: number) => string
}

/** Options for one native emission. */
export interface NativeEmitOptions {
  keepComments: boolean
  isolatedDeclarations: boolean
  /** Source path selects TypeScript/TSX syntax and identifies contextual emission. */
  sourceFile?: string
  /** Authored dependency snapshots for monomorphic call inference, by import specifier. */
  inferenceSources?: ReadonlyMap<string, string>
  /** Original imports the project's augmentation graph requires. */
  augmentationImports?: ReadonlySet<string>
  /** Engine requested for this emission; `typescript` makes it return `null`. */
  engine?: DeclarationEngine
}

/**
 * The engine that emits declarations. `native` is the default and falls back
 * to the TypeScript engine when the native library cannot load; `typescript`
 * always runs the original pure-TypeScript engine.
 */
export type DeclarationEngine = 'native' | 'typescript'

const engines: readonly DeclarationEngine[] = ['native', 'typescript']

/** Read an engine name from a flag, config value or environment variable. */
export function parseDeclarationEngine(value: unknown, source: string = 'engine'): DeclarationEngine | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string' && (engines as readonly string[]).includes(value)) return value as DeclarationEngine
  throw new Error(`Invalid ${source} ${JSON.stringify(value)}: expected "native" or "typescript"`)
}

let processEngine: DeclarationEngine | undefined

/**
 * Set the engine for every later emission in this process that does not name
 * one itself (the CLI's `--engine` flag). `undefined` restores the default.
 */
export function setDeclarationEngine(engine: DeclarationEngine | undefined): void {
  processEngine = parseDeclarationEngine(engine)
}

/**
 * The engine an emission will ask for: the one requested for that call, else
 * the process-wide one, else `DTSX_ENGINE`, else `native`.
 */
export function resolveDeclarationEngine(requested?: DeclarationEngine): DeclarationEngine {
  return parseDeclarationEngine(requested) ?? processEngine ?? parseDeclarationEngine(process.env.DTSX_ENGINE, 'DTSX_ENGINE') ?? 'native'
}

let loaded: NativeLibrary | null | undefined

function platformSlug(): string {
  const os = platform() === 'win32' ? 'windows' : platform()
  return `${os}-${arch()}`
}

function candidatePaths(fileName: string): string[] {
  const paths: string[] = []
  const explicit = process.env.DTSX_NATIVE_LIBRARY
  if (explicit) paths.push(explicit)
  for (const relative of [
    // Published package: <package>/native/<platform>/ beside dist/, reached
    // from a dist/ chunk or from dist/bin/.
    `../native/${platformSlug()}/${fileName}`,
    `../../native/${platformSlug()}/${fileName}`,
    // Monorepo development: the sibling native package's build output.
    `../../zig-dtsx/zig-out/lib/${fileName}`,
    `../../zig-dtsx/zig-out/bin/${fileName}`,
  ]) {
    try {
      paths.push(fileURLToPath(new URL(relative, import.meta.url)))
    }
    catch { /* not a file URL */ }
  }
  return paths
}

function load(): NativeLibrary | null {
  if (typeof globalThis.Bun === 'undefined') return null
  let ffi: typeof import('bun:ffi')
  try {
    ffi = import.meta.require('bun:ffi')
  }
  catch {
    return null
  }
  const { dlopen, FFIType, ptr, suffix, toArrayBuffer } = ffi
  const fileName = suffix === 'dll' ? `zig-dtsx.${suffix}` : `libzig-dtsx.${suffix}`
  for (const path of candidatePaths(fileName)) {
    if (!existsSync(path)) continue
    try {
      const library = dlopen(path, {
        process_source_checked_v1: { args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
        process_source_with_context_v1: { args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.bool, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
        free_result: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
      })
      const { symbols } = library
      const decoder = new TextDecoder()
      return {
        checked: (source, length, keepComments, isolated, outLength, outStatus) =>
          symbols.process_source_checked_v1(ptr(source), length, keepComments, isolated, ptr(outLength), ptr(outStatus)),
        contextual: (source, length, keepComments, isolated, context, contextLength, outLength, outStatus) =>
          symbols.process_source_with_context_v1(ptr(source), length, keepComments, isolated, ptr(context), contextLength, ptr(outLength), ptr(outStatus)),
        read: (result, length) => {
          if (!result) return ''
          const text = length ? decoder.decode(toArrayBuffer(result as any, 0, length)) : ''
          symbols.free_result(result as any, length)
          return text
        },
      }
    }
    catch {
      continue
    }
  }
  return null
}

function library(): NativeLibrary | null {
  if (loaded === undefined) loaded = load()
  return loaded
}

/**
 * Whether an emission asking for `engine` (default: the resolved engine) runs
 * natively: the native engine is selected and its library loads here.
 */
export function nativeEngineAvailable(engine?: DeclarationEngine): boolean {
  return resolveDeclarationEngine(engine) === 'native' && library() !== null
}

const encoder = new TextEncoder()
let input = new Uint8Array(64 * 1024)
const outLength = new BigUint64Array(1)
const outStatus = new Uint32Array(1)

/**
 * Emit declarations natively. Returns `null` when the engine is unavailable or
 * the native emitter rejects the input, so the caller can use the TypeScript
 * engine instead.
 */
export function emitWithNativeEngine(source: string, options: NativeEmitOptions): string | null {
  if (resolveDeclarationEngine(options.engine) === 'typescript') return null
  const native = library()
  if (!native) return null
  if (source.length * 3 > input.length) input = new Uint8Array(source.length * 3)
  const { written } = encoder.encodeInto(source, input)
  const needsContext = options.sourceFile !== undefined || (options.inferenceSources?.size ?? 0) > 0 || (options.augmentationImports?.size ?? 0) > 0
  let result: unknown
  if (needsContext) {
    const sourceFile = options.sourceFile ?? 'source.ts'
    const context = encoder.encode(JSON.stringify({
      version: 1,
      moduleSpecifierMode: 'preserve',
      sourceFile,
      outputFile: sourceFile.replace(/\.(?:[cm]?[jt]sx?|vue|stx)$/, '.d.ts'),
      sourceHash: new Bun.CryptoHasher('sha256').update(input.subarray(0, written)).digest('hex'),
      rewrites: [],
      augmentationImports: [...(options.augmentationImports ?? [])],
      inferenceSources: [...(options.inferenceSources ?? [])].map(([specifier, text]) => ({ specifier, source: text })),
    }))
    result = native.contextual(input, written, options.keepComments, options.isolatedDeclarations, context, context.length, outLength, outStatus)
  }
  else {
    result = native.checked(input, written, options.keepComments, options.isolatedDeclarations, outLength, outStatus)
  }
  const length = Number(outLength[0])
  if (outStatus[0] !== 0) {
    native.read(result, length)
    return null
  }
  return native.read(result, length)
}

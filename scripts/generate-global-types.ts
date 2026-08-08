/**
 * Regenerate `packages/dtsx/src/global-types.ts`.
 *
 * The dangling-reference check needs to know which type names resolve without
 * an import. Hand-maintaining that list is how it goes stale — a new lib
 * release adds `Float16Array`, nobody notices, and every declaration using it
 * gets reported as broken. So it is derived from the `lib.*.d.ts` files
 * TypeScript actually ships.
 *
 *   bun scripts/generate-global-types.ts [path/to/typescript/lib]
 *
 * The path is optional: without one this looks through node_modules for an
 * installed TypeScript that still ships its lib files. The Go port
 * (TypeScript 7) does not, so pass a 5.x install if the lookup fails.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** Ambients that are real but live outside the TypeScript lib files. */
const NON_LIB_GLOBALS = [
  // Node
  'Buffer', 'BufferEncoding', 'NodeJS', 'NodeRequire', 'NodeModule', 'Timer',
  'Timeout', 'Immediate', 'ErrorOptions', 'ArrayBufferView', 'ArrayBufferLike',
  'TypedArray', 'Console', 'WithImplicitCoercion', 'Dirent', 'Stats',
  // Bun
  'Bun', 'BunFile', 'Subprocess', 'ShellPromise', 'Server', 'ServerWebSocket',
  'WebSocketHandler', 'Socket', 'TCPSocket', 'SocketHandler', 'FileSink',
  // Shared runtime surface
  'process', 'global', 'globalThis', 'Disposable', 'AsyncDisposable',
  'structuredClone',
]

/** Declarations in a lib file that introduce a globally available name. */
const DECLARATION = /^\s*(?:declare\s+)?(?:interface|type|declare var|declare const|declare function|declare namespace|namespace)\s+([A-Z][\w$]*)/gm

function findLibDirectory(): string | null {
  const fromArgument = process.argv[2]
  if (fromArgument)
    return existsSync(join(fromArgument, 'lib.es5.d.ts')) ? fromArgument : null

  const candidates = [
    'node_modules/typescript/lib',
    '../../node_modules/typescript/lib',
  ]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'lib.es5.d.ts')))
      return candidate
  }

  return null
}

const libDirectory = findLibDirectory()

if (!libDirectory) {
  console.error(
    'Could not find TypeScript\'s lib files.\n'
    + 'TypeScript 7 (the native port) does not ship them, so point this at a 5.x install:\n'
    + '  bun scripts/generate-global-types.ts ./node_modules/typescript/lib',
  )
  process.exit(1)
}

const names = new Set(NON_LIB_GLOBALS)

const libFiles = readdirSync(libDirectory)
  .filter(file => file.startsWith('lib.') && file.endsWith('.d.ts'))

for (const file of libFiles) {
  const source = readFileSync(join(libDirectory, file), 'utf8')
  for (const match of source.matchAll(DECLARATION))
    names.add(match[1]!)
}

const sorted = [...names].sort()

const header = `/**
 * Type names that every TypeScript program already has.
 *
 * Generated from the \`lib.*.d.ts\` files TypeScript ships, plus the Node and
 * Bun ambients that live outside them. Referencing one of these from a
 * declaration is never dangling, so \`dangling-refs\` treats the whole set as
 * resolved.
 *
 * Whether a given consumer actually loads \`lib.dom\` depends on their tsconfig,
 * so a Node-only package referencing \`HTMLElement\` is arguably broken and is
 * not reported here. That is deliberate: this check exists to catch names that
 * resolve nowhere, and a false positive that fails a build is far more
 * expensive than a miss.
 *
 * Regenerate with \`bun scripts/generate-global-types.ts\`.
 */
export const GLOBAL_TYPE_NAMES: ReadonlySet<string> = new Set([`

const lines = [header]
let row = ' '

for (const name of sorted) {
  const piece = ` '${name}',`
  if ((row + piece).length > 78) {
    lines.push(row)
    row = ' '
  }
  row += piece
}

if (row.trim())
  lines.push(row)

lines.push('])', '')

writeFileSync('packages/dtsx/src/global-types.ts', lines.join('\n'))

console.log(`Wrote ${sorted.length} global type names from ${libFiles.length} lib files.`)

/**
 * Shared, verified tool locations for the cross-tool benchmarks.
 *
 * Every tool is resolved to the executable that actually does the work, so no
 * benchmark row silently times a failed spawn (for example a `#!/usr/bin/env node`
 * shim on a machine without Node).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'

const root = join(import.meta.dir, '..')

export const dtsxExe: string = join(root, 'packages', 'dtsx', 'bin', 'dtsx')
export const zigDtsxExe: string = join(root, 'packages', 'zig-dtsx', 'zig-out', 'bin', 'zig-dtsx')
export const oxcExe: string = join(import.meta.dir, 'oxc-emit')

/**
 * TypeScript 7 ships `tsc` as a native Go executable behind a Node shim.
 * Resolve the native executable directly so tsc is measured without a Node
 * launcher (which also removes any launcher overhead from its numbers).
 */
export function resolveNativeTsc(): string {
  const pkg = Bun.resolveSync('typescript/package.json', root)
  const native = join(dirname(pkg), '..', '@typescript', `typescript-${platform()}-${arch()}`, 'lib', platform() === 'win32' ? 'tsc.exe' : 'tsc')
  if (existsSync(native)) return native
  return join(dirname(pkg), 'bin', 'tsc')
}

export const tscExe: string = resolveNativeTsc()

/** Bun --compile cannot load N-API addons from its virtual FS; point oxc at the real binding. */
export const oxcCliEnv: Record<string, string | undefined> = (() => {
  try {
    const pkgDir = join(root, 'node_modules', `@oxc-transform/binding-${platform()}-${arch()}`)
    const nodeFile = readdirSync(pkgDir).find(f => f.endsWith('.node'))
    return nodeFile ? { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: join(pkgDir, nodeFile) } : process.env
  }
  catch {
    return process.env
  }
})()

function pkgVersion(name: string): string {
  try {
    return JSON.parse(readFileSync(Bun.resolveSync(`${name}/package.json`, root), 'utf8')).version
  }
  catch {
    return 'unknown'
  }
}

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return ''
  }
}

export interface MachineInfo {
  model: string
  cpu: string
  cores: number
  performanceCores?: number
  efficiencyCores?: number
  memoryGB: number
  os: string
  arch: string
  bun: string
  versions: Record<string, string>
}

export function machineInfo(): MachineInfo {
  const isMac = platform() === 'darwin'
  const model = isMac ? sh('sysctl', ['-n', 'hw.model']) : ''
  const cpu = isMac ? sh('sysctl', ['-n', 'machdep.cpu.brand_string']) : (cpus()[0]?.model ?? 'unknown')
  const perf = isMac ? Number(sh('sysctl', ['-n', 'hw.perflevel0.physicalcpu'])) || undefined : undefined
  const eff = isMac ? Number(sh('sysctl', ['-n', 'hw.perflevel1.physicalcpu'])) || undefined : undefined
  const os = isMac ? `macOS ${sh('sw_vers', ['-productVersion'])}` : `${platform()} ${release()}`
  const pantryZig = (() => {
    try {
      const dir = join(root, 'pantry', 'ziglang.org')
      const latest = readdirSync(dir).filter(v => v.startsWith('v')).sort().pop()
      return latest ? join(dir, latest, 'zig') : ''
    }
    catch {
      return ''
    }
  })()
  const zig = sh('zig', ['version']) || (pantryZig ? sh(pantryZig, ['version']) : '')
  return {
    model,
    cpu,
    cores: cpus().length,
    performanceCores: perf,
    efficiencyCores: eff,
    memoryGB: Math.round(totalmem() / 1024 ** 3),
    os,
    arch: arch(),
    bun: Bun.version,
    versions: {
      'dtsx': pkgVersion('@stacksjs/dtsx'),
      'zig': zig || 'unknown',
      'oxc-transform': pkgVersion('oxc-transform'),
      'typescript': pkgVersion('typescript'),
      'tsdown': pkgVersion('tsdown'),
    },
  }
}

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { nativeBuildInfo, oxcExe } from './tools'

async function prepare(): Promise<void> {
  const root = resolve(import.meta.dir, '..')
  const zig = join(root, 'pantry', '.bin', process.platform === 'win32' ? 'zig.exe' : 'zig')
  if (!existsSync(zig)) throw new Error('Install the declared toolchain with pantry install before preparing benchmarks')
  for (const [cwd, command] of [
    [join(root, 'packages/zig-dtsx'), [zig, 'build', '-Doptimize=ReleaseFast', '-j2']],
    [root, [process.execPath, 'build', 'benchmark/oxc-emit.ts', '--compile', '--splitting', '--bytecode', '--minify', '--format=esm', '--outfile', oxcExe]],
  ] as const) {
    const child = Bun.spawn([...command], { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    const code = await child.exited
    if (code !== 0) throw new Error(`Benchmark preparation failed (${code}): ${command[0]}`)
  }
  process.stdout.write(`${JSON.stringify(nativeBuildInfo())}\n`)
}

prepare().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})

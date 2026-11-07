import { expect } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runTsc } from './tsc'

/** Require strict-valid authored source before checking a real emit diagnostic. */
export async function assertIsolatedDeclarationDiagnostic(code: string, source: string): Promise<void> {
  const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
  const root = await mkdtemp(join(tmpdir(), 'dtsx-literal-oracle-'))
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(join(root, 'index.ts'), source)
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...compilerOptions }, files: ['index.ts'] }))
    const authored = runTsc(root, ['--project', 'tsconfig.json'])
    expect(authored.ok, authored.output).toBe(true)
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, isolatedDeclarations: true, declaration: true, emitDeclarationOnly: true, noEmitOnError: true, outDir: './out' }, files: ['index.ts'] }))
    const oracle = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.json'], { cwd: root, timeout: 4000 })
    const diagnostics = oracle.stdout.toString() + oracle.stderr.toString()
    expect(oracle.exitCode, diagnostics).not.toBe(0)
    expect(diagnostics.match(/error TS\d+/g) ?? [], diagnostics).toEqual([`error ${code}`])
  }
  finally { await rm(root, { recursive: true, force: true }) }
}

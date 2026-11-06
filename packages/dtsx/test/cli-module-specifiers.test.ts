import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const cli = resolve(import.meta.dir, '../bin/cli.ts')

for (const scenario of [
  { name: 'defaults to preserve', configured: undefined, flag: undefined, expected: './options' },
  { name: 'loads node mode from the project config', configured: 'node', flag: undefined, expected: './options.js' },
  { name: 'accepts explicit node mode', configured: undefined, flag: 'node', expected: './options.js' },
  { name: 'lets explicit preserve override project node mode', configured: 'node', flag: 'preserve', expected: './options' },
  { name: 'lets explicit node override project preserve mode', configured: 'preserve', flag: 'node', expected: './options.js' },
  { name: 'rejects an unsupported explicit mode', configured: undefined, flag: 'nod', expected: null },
  { name: 'rejects an unsupported project mode', configured: 'nod', flag: undefined, expected: null },
] as const) {
  test(`generate CLI ${scenario.name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-cli-specifiers-'))
    try {
      await mkdir(join(directory, 'src'))
      await writeFile(join(directory, 'src/index.ts'), "export type { Options } from './options'\n")
      await writeFile(join(directory, 'src/options.ts'), 'export interface Options { scale: number }\n')
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
      if (scenario.configured) {
        await writeFile(join(directory, 'dtsx.config.ts'), `export default { moduleSpecifierMode: '${scenario.configured}' }\n`)
      }
      const args = [process.execPath, cli, 'generate', '--root', 'src', '--outdir', 'dist', '--entrypoints', 'index.ts']
      if (scenario.flag) args.push('--module-specifier-mode', scenario.flag)
      const child = Bun.spawn(args, { cwd: directory, stdout: 'pipe', stderr: 'pipe', timeout: 10000 })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      if (scenario.expected === null) {
        expect(code).not.toBe(0)
        expect(stderr).toContain('moduleSpecifierMode must be preserve or node')
        expect(await Bun.file(join(directory, 'dist/index.d.ts')).exists()).toBe(false)
        return
      }
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      const output = await readFile(join(directory, 'dist/index.d.ts'), 'utf8')
      expect(output).toContain(`from '${scenario.expected}'`)
      expect(await readFile(join(directory, 'dist/options.d.ts'), 'utf8')).toContain('interface Options')
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)
}

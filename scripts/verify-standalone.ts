import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const core = resolve(import.meta.dir, '../packages/dtsx')
const manifest = JSON.parse(await readFile(join(core, 'package.json'), 'utf8'))
assert(Object.keys(manifest.dependencies ?? {}).length === 0, 'The bundled DTSX package must have no required npm dependencies')
const directory = await mkdtemp(join(tmpdir(), 'dtsx-standalone-'))
const requests: string[] = []
const registry = Bun.serve({
  port: 0,
  fetch(request) {
    requests.push(new URL(request.url).pathname)
    return new Response('This standalone consumer has no external packages', { status: 404 })
  },
})

async function command(args: string[], cwd: string): Promise<void> {
  const child = Bun.spawn([process.execPath, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 15000 })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  assert(code === 0, `${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`)
}

try {
  const archive = join(directory, 'dtsx.tgz')
  await command(['pm', 'pack', '--filename', archive], core)
  const consumer = join(directory, 'consumer')
  await mkdir(join(consumer, 'src'), { recursive: true })
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@stacksjs/dtsx': `file:${archive}` } }))
  await writeFile(join(consumer, 'bunfig.toml'), `[install]\nregistry = "${registry.url}"\n`)
  await command(['install'], consumer)
  await command(['install', '--frozen-lockfile'], consumer)
  assert(requests.length === 0, `Standalone installation contacted a registry: ${requests.join(', ')}`)
  await writeFile(join(consumer, 'src/index.ts'), 'export class Calculate { #hidden = () => ({ value: 2 }); value(): number { return this.#hidden().value } }')
  await writeFile(join(consumer, 'verify.ts'), `
    import { generate, getConfig, processSource } from '@stacksjs/dtsx'
    import { dts } from '@stacksjs/dtsx/tsdown'
    import { readFile } from 'node:fs/promises'
    for (const provider of ['tsup', 'tsdown', 'typescript', '@stacksjs/clapp', 'bunfig', 'prettier']) {
      let installed = false
      try { Bun.resolveSync(provider, process.cwd()); installed = true } catch {}
      if (installed) throw new Error('Unexpected installed provider: ' + provider)
    }
    await getConfig(process.cwd())
    if (dts().name !== 'dtsx') throw new Error('The tsdown adapter must import without its host')
    const declaration = processSource('export const answer = 42', 'answer.ts')
    if (!declaration.includes('answer')) throw new Error('Standalone transform failed')
    const stats = await generate({ cwd: process.cwd(), root: './src', entrypoints: ['index.ts'], outdir: './dist' })
    if (stats.filesGenerated !== 1 || !(await readFile('dist/index.d.ts', 'utf8')).includes('value(): number')) throw new Error('Standalone generation failed')
  `)
  await command(['verify.ts'], consumer)
  const cli = join(consumer, 'node_modules/@stacksjs/dtsx/dist/bin/cli.js')
  await command([cli, '--help'], consumer)
  await command([cli, 'generate', '--cwd', consumer, '--root', 'src', '--entrypoints', 'index.ts', '--outdir', 'cli-dist'], consumer)
  assert((await readFile(join(consumer, 'cli-dist/index.d.ts'), 'utf8')).includes('value(): number'), 'Standalone CLI failed to generate the private-arrow class')
  console.log(JSON.stringify({ standalone: true, requiredDependencies: 0, externalRegistryRequests: requests.length, normalAndFrozenInstall: true, api: true, cli: true }))
}
finally {
  await registry.stop(true)
  await rm(directory, { recursive: true, force: true })
}

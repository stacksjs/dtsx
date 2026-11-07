import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const adapterURL = pathToFileURL(resolve(import.meta.dir, '../../bun-plugin/src/index.ts')).href
const tsconfig = resolve(import.meta.dir, '../../../tsconfig.json')

for (const custom of [false, true]) {
  test(`Bun incremental builds have one authoritative ${custom ? 'custom' : 'default'} cache and preserve unrelated files when cleared`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-bun-cache-owner-'))
    try {
      await mkdir(join(directory, 'src'))
      await writeFile(join(directory, 'src/index.ts'), "export type { Options } from './options'\n")
      await writeFile(join(directory, 'src/options.ts'), 'export interface Options { scale: number }\n')
      const script = `
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dts, clearCache } from ${JSON.stringify(adapterURL)}
const custom = ${custom}
const cacheDir = custom ? 'shared-build-cache' : '.dtsx-cache'
const generated = []
const hits = []
async function build() {
  const result = await Bun.build({
    entrypoints: ['./src/index.ts'], outdir: './dist', target: 'node', format: 'esm',
    plugins: [dts({ incremental: true, clean: false, logLevel: 'silent',
      ...(custom ? { cacheDir } : {}),
      onSuccess(stats) { generated.push(stats.filesGenerated) },
      on: { complete(event) { if (event.data.type === 'complete') hits.push(event.data.fromCache) } },
    })],
  })
  assert.equal(result.success, true, result.logs.map(log => log.message).join('\\n'))
}
await build()
const first = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
assert.equal(first.version, 14)
assert.equal(Object.keys(first.entries).length, 2)
assert.match(first.entries['src/index.ts'].dtsContent, /options\\.js/)
await build()
assert.deepEqual(generated, [2, 0])
assert.deepEqual(hits, [0, 2])
// A custom cache directory may be shared with other tools. Clearing our cache
// must never recursively delete that directory or unrelated user content.
await mkdir(join(cacheDir, 'other-tool'), { recursive: true })
await writeFile(join(cacheDir, 'other-tool/keep.txt'), 'retain me')
clearCache(cacheDir)
assert.equal(await Bun.file(join(cacheDir, 'manifest.json')).exists(), false)
assert.equal(await readFile(join(cacheDir, 'other-tool/keep.txt'), 'utf8'), 'retain me')
await build()
assert.deepEqual(generated, [2, 0, 2])
assert.deepEqual(hits, [0, 2, 0])
console.log('cache-ownership-pass')
`
      const child = Bun.spawn([process.execPath, '--tsconfig-override', tsconfig, '--eval', script], {
        cwd: directory, stdout: 'pipe', stderr: 'pipe', timeout: 10000,
      })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      expect(stdout.trim()).toBe('cache-ownership-pass')
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)
}

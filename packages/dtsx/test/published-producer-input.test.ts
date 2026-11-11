import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

for (const failure of ['version', 'local-native-build', 'source-alias', 'native-override'] as const) {
  test(`published producer inputs reject ${failure} without falling back to source`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-producer-input-'))
    try {
      const configuration = { version: '1.0.0', core: join(directory, 'core'), bunPlugin: join(directory, 'plugin'), native: join(directory, 'native') }
      for (const [key, name] of [['core', '@dtsx/dtsx'], ['bunPlugin', '@dtsx/bun'], ['native', 'zig-dtsx']] as const) {
        const root = configuration[key]
        await mkdir(root)
        await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: failure === 'version' ? '0.0.0' : '1.0.0', type: 'module', exports: { '.': { import: './entry.js' }, './*': { import: './*.js' } } }))
        await writeFile(join(root, 'entry.js'), 'export {}')
        for (const subpath of ['generator', 'cache']) await writeFile(join(root, `${subpath}.js`), 'export {}')
      }
      if (failure === 'local-native-build') await mkdir(join(configuration.native, 'zig-out'))
      await writeFile(join(directory, 'producers.json'), JSON.stringify(configuration))
      await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
      const paths: Record<string, string[]> = {}
      if (failure === 'source-alias') {
        const source = join(directory, 'unreleased-source')
        await mkdir(source)
        for (const subpath of ['', 'generator', 'cache']) {
          const file = join(source, `${subpath || 'entry'}.js`)
          await writeFile(file, 'export {}')
          paths[`@dtsx/dtsx${subpath ? `/${subpath}` : ''}`] = [file]
        }
      }
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths } }))
      const helper = pathToFileURL(join(import.meta.dir, 'helpers/declaration-package.ts')).href
      await writeFile(join(directory, 'probe.test.ts'), `import { test } from 'bun:test';
import { checkDeclarationPackage } from ${JSON.stringify(helper)};
test('reject invalid producer input', () => checkDeclarationPackage('core', {
  source: 'export const value = 1', positive: 'const value: 1 = api.value',
  negatives: [{ code: 2322, content: 'const wrong: 2 = api.value' }]
}));`)
      const child = Bun.spawn([process.execPath, 'test', '--no-env-file', '--tsconfig-override', join(directory, 'tsconfig.json'), './probe.test.ts'], {
        cwd: directory, env: { ...process.env, DTSX_DECLARATION_PRODUCERS: join(directory, 'producers.json'), DTSX_DECLARATION_PRODUCER_RECEIPT: undefined, DTSX_TEST_TRACE: undefined, DTSX_NATIVE_LIBRARY: failure === 'native-override' ? join(directory, 'local-build.dylib') : undefined }, stdout: 'pipe', stderr: 'pipe', timeout: 10_000,
      })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      const output = stdout + stderr
      expect(code, output).not.toBe(0)
      const reason = { version: '@1.0.0, received ', 'local-native-build': 'cannot contain a local zig-out build', 'source-alias': 'resolves outside its configured public core entry', 'native-override': 'cannot use DTSX_NATIVE_LIBRARY' }[failure]
      expect(output).toContain(reason)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  }, 15_000)
}

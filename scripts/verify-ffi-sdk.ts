import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Pack the assembled SDK normally. This gate never builds a library, repairs
// an archive, or imports a workspace binding instead of the installed package.
const root = resolve(import.meta.dir, '..')
const packageRoot = resolve(process.env.DTSX_FFI_PACKAGE_ROOT ?? join(root, 'packages/zig-dtsx'))
const evidenceRoot = process.env.DTSX_FFI_EVIDENCE ?? tmpdir()
await mkdir(evidenceRoot, { recursive: true })
const evidence = await mkdtemp(join(evidenceRoot, 'dtsx-ffi-sdk-'))
const consumer = join(evidence, 'consumer')
const archive = join(evidence, 'zig-dtsx.tgz')
const slug = `${process.platform}-${process.arch}`
const libraryName = process.platform === 'win32' ? 'zig-dtsx.dll' : `libzig-dtsx.${process.platform === 'darwin' ? 'dylib' : 'so'}`
const commands: Array<Record<string, unknown>> = []
const inventory: Array<{ path: string, sha256: string, size: number }> = []
const receipt: Record<string, unknown> = {
  kind: 'normally packed and installed native FFI SDK qualification', status: 'FAIL',
  packageRoot, evidence, archive, platform: slug, commands, inventory,
  qualification: 'Prepublication file archive; public Pantry registry delivery requires separate verification.',
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
async function run(name: string, args: string[], cwd: string, expectedSuccess = true): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  const log = `${String(commands.length).padStart(3, '0')}-${name}.log`
  const output = stdout + stderr
  await writeFile(join(evidence, log), output)
  commands.push({ name, args, cwd, code, log })
  assert.notEqual(code, null, output)
  assert.equal(code === 0, expectedSuccess, output)
  return output
}

try {
  assert(!process.env.DTSX_NATIVE_LIBRARY, 'A packed SDK must select its own normally installed library')
  assert(process.argv.slice(2).every(arg => arg === '--all-platforms'), 'Unknown FFI qualification argument')
  await run('pack', [process.execPath, '--no-env-file', 'pm', 'pack', '--filename', archive], packageRoot)
  const bytes = await readFile(archive)
  receipt.archiveSHA256 = hash(bytes)
  const files = await new Bun.Archive(bytes).files()
  const manifestFile = files.get('package/package.json')
  assert(manifestFile, 'The normal archive must contain its manifest')
  const manifest = JSON.parse(await manifestFile.text())
  assert.equal(manifest.name, 'zig-dtsx')
  assert.equal(manifest.version, (await Bun.file(join(root, 'package.json')).json()).version)
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.keys(manifest[section] ?? {}).length, 0, `${section} must not add runtime npm requirements`)
  }
  receipt.manifest = manifest
  const hostLibrary = `package/prebuilt/${slug}/${libraryName}`
  assert(files.has(hostLibrary), `The normal archive must contain its host library: ${hostLibrary}`)
  if (process.argv.includes('--all-platforms')) {
    for (const platform of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64', 'freebsd-x64']) {
      const name = platform.startsWith('windows') ? 'zig-dtsx.dll' : `libzig-dtsx.${platform.startsWith('darwin') ? 'dylib' : 'so'}`
      assert(files.has(`package/prebuilt/${platform}/${name}`), `Missing assembled ${platform} library`)
    }
  }
  for (const [path, file] of files) {
    assert(path.startsWith('package/') && !path.includes('\\') && !path.split('/').includes('..'), `Unsafe member ${path}`)
    assert(!path.includes('/zig-out/') && !path.includes('/node_modules/'), `A published SDK cannot use local build outputs: ${path}`)
    const content = new Uint8Array(await file.arrayBuffer())
    inventory.push({ path, sha256: hash(content), size: content.length })
  }
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true, type: 'module', dependencies: { 'zig-dtsx': `file:${archive}` },
    devDependencies: { typescript: '7.0.2', '@types/bun': '1.4.4' },
  }))
  const source = 'export class Calculate { #hidden = () => ({ value: 2 }); value(): number { return this.#hidden().value } }\nexport function sum(first: number = 1, last: number): number { return first + last }\n'
  await writeFile(join(consumer, 'source.ts'), source)
  receipt.sourceSHA256 = hash(new TextEncoder().encode(source))
  const runtime = `import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { ZIG_AVAILABLE, ZIG_CONTEXT_AVAILABLE, ZIG_CHECKED_AVAILABLE, ZIG_CHECKED_BATCH_AVAILABLE, processSource, processBatch } from 'zig-dtsx';
assert(ZIG_AVAILABLE && ZIG_CONTEXT_AVAILABLE && ZIG_CHECKED_AVAILABLE && ZIG_CHECKED_BATCH_AVAILABLE);
const source = ${JSON.stringify(source)};
const sources = Array.from({ length: 16 }, (_, index) => index === 0 ? source : index === 1 ? '' : 'export const item' + index + ': number = ' + index + ';');
const expected = sources.map(text => processSource(text));
assert.equal(expected[1], '');
const unsupported = 'let value: number | undefined = 7; if (Math.random() > 0.5) { value = undefined; } export const alias = value;';
for (const threads of [1, 2, 4]) {
  assert.deepEqual(processBatch(sources, true, threads), expected);
  assert.throws(() => processBatch([...sources.slice(0, 15), unsupported], true, threads), error => error instanceof Error && Reflect.get(error, 'code') === 'DTSX_UNSUPPORTED_VALUE_FLOW');
  assert.deepEqual(processBatch(sources, true, threads), expected);
}
await writeFile('api.d.ts', expected[0]);
console.log(JSON.stringify({ available: true, checkedBatch: true, inputs: 16, threads: [1, 2, 4], errorAndRecovery: true }));
`
  await writeFile(join(consumer, 'runtime.ts'), runtime)
  const compiler = join(consumer, 'node_modules/typescript/lib/tsc.js')
  const compilerOptions = { strict: true, skipLibCheck: false, types: ['bun'], paths: {}, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true }
  async function checkCompiler(name: string, text: string, errors: number[] = []): Promise<void> {
    await writeFile(join(consumer, 'control.ts'), text)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
    const output = await run(name, [process.execPath, '--no-env-file', compiler, '--project', 'tsconfig.json', '--pretty', 'false'], consumer, errors.length === 0)
    assert.deepEqual((output.match(/error TS\d+/g) ?? []), errors.map(code => `error TS${code}`), output)
    if (errors.length) assert.equal((output.match(/control\.ts\(/g) ?? []).length, errors.length, output)
  }
  async function declarationControls(specifier: string, label: string): Promise<void> {
    const header = `import { Calculate, sum } from '${specifier}';\n`
    await checkCompiler(`${label}-positive`, `${header}const value: number = new Calculate().value(); const total: number = sum(undefined, 2); type IsAny<T> = 0 extends (1 & T) ? true : false; const safe: false = null as unknown as IsAny<ReturnType<Calculate['value']>>;`)
    await checkCompiler(`${label}-negative`, `${header}new Calculate().hidden(); const wrong: string = sum(1, 2); sum(1, 'wrong');`, [2339, 2322, 2345])
  }
  let lock: string | undefined
  let declaration: string | undefined
  for (const frozen of [false, true]) {
    const label = frozen ? 'fresh-frozen' : 'normal'
    await run(`${label}-install`, [process.execPath, '--no-env-file', 'install', ...(frozen ? ['--frozen-lockfile'] : [])], consumer)
    const installed = join(consumer, 'node_modules/zig-dtsx')
    assert(!existsSync(join(installed, 'zig-out')), 'No local-build fallback can enter the installed SDK')
    assert.equal(await realpath(Bun.resolveSync('zig-dtsx', consumer)), await realpath(join(installed, 'src/index.ts')))
    assert.equal((await Bun.file(join(consumer, 'node_modules/typescript/package.json')).json()).version, '7.0.2')
    for (const member of inventory) assert.equal(hash(new Uint8Array(await readFile(join(installed, member.path.slice(8))))), member.sha256, `Installed bytes differ: ${member.path}`)
    const currentLock = await readFile(join(consumer, 'bun.lock'), 'utf8')
    if (frozen) assert.equal(currentLock, lock)
    else { lock = currentLock; await declarationControls('./source.js', 'authored') }
    await run(`${label}-runtime`, [process.execPath, '--no-env-file', 'runtime.ts'], consumer)
    const emitted = await readFile(join(consumer, 'api.d.ts'), 'utf8')
    if (frozen) assert.equal(emitted, declaration)
    else declaration = emitted
    const header = "import { processSource, processBatch, type SourceEmissionContext } from 'zig-dtsx';\n"
    await checkCompiler(`${label}-sdk-positive`, `${header}const text: string = processSource(''); const batch: string[] = processBatch([''], true, 4); const version: SourceEmissionContext['version'] = 1; type IsAny<T> = 0 extends (1 & T) ? true : false; const safe: false = null as unknown as IsAny<ReturnType<typeof processBatch>[number]>;`)
    await checkCompiler(`${label}-sdk-negative`, `${header}processBatch([''], true, 'wrong'); const version: SourceEmissionContext['version'] = 2; const wrong: number = processSource('');`, [2345, 2322, 2322])
    await declarationControls('./api.js', label)
    // A fresh frozen installation must reconstruct the same normally packed
    // SDK; the preceding node_modules tree cannot satisfy this second check.
    await rm(join(consumer, 'node_modules'), { recursive: true })
  }
  receipt.lockSHA256 = hash(new TextEncoder().encode(lock!))
  receipt.declarationSHA256 = hash(new TextEncoder().encode(declaration!))
  receipt.status = 'PASS'
  console.log(`Normally packed native FFI SDK, real parallel batches, strict API/emission and fresh frozen consumers PASS: ${evidence}`)
}
catch (error) {
  receipt.error = error instanceof Error ? error.stack : String(error)
  console.error(error)
  process.exitCode = 1
}
finally {
  await writeFile(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
}

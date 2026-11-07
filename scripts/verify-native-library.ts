/** Exercise a packaged FFI library in isolation, then strictly consume its emitted API. */
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { arch, platform, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dlopen, FFIType, suffix } from 'bun:ffi'

const packageDirectory = resolve(process.argv[2] ?? join(import.meta.dir, '../packages/zig-dtsx'))
const compiler = resolve(process.argv[3] ?? join(import.meta.dir, '../node_modules/typescript/bin/tsc'))
const slug = `${platform()}-${arch()}`
const libraryName = `libzig-dtsx.${suffix}`
const libraryPath = join(packageDirectory, 'prebuilt', slug, libraryName)
// Unlike the binding's optional fallback, this preserves the precise loader diagnostic.
const library = dlopen(libraryPath, { result_length: { args: [FFIType.ptr], returns: FFIType.u64 } })
library.close()

const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-release-'))
try {
  const isolatedPackage = join(directory, 'package')
  await mkdir(join(isolatedPackage, 'prebuilt', slug), { recursive: true })
  await cp(join(packageDirectory, 'src'), join(isolatedPackage, 'src'), { recursive: true })
  await cp(libraryPath, join(isolatedPackage, 'prebuilt', slug, libraryName))
  const binding = await import(pathToFileURL(join(isolatedPackage, 'src/index.ts')).href)
  assert.equal(binding.ZIG_AVAILABLE, true, 'The packaged binding must load every required FFI symbol')
  const source = `export interface Model { readonly id: string; value: number }
export function create(id: string, value: number): Model { return { id, value } }
export class Store<T> {
  private readonly data: T;
  constructor(data: T) { this.data = data }
  get(): T { return this.data }
}
export type Patch = Partial<Pick<Model, 'value'>>;
export enum Status { Ready = 'ready' }
`
  const declarations: string = binding.processSource(source, true, true)
  assert(declarations.trim(), 'Native declaration emission must produce output')
  await writeFile(join(directory, 'api.d.ts'), declarations)
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, skipLibCheck: false, noEmit: true, types: [], target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' },
    files: ['consumer.ts'],
  }))
  async function checkConsumer(source: string) {
    await writeFile(join(directory, 'consumer.ts'), source)
    const child = Bun.spawn([process.execPath, compiler, '-p', join(directory, 'tsconfig.json'), '--pretty', 'false'], { stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, diagnostics: stdout + stderr }
  }
  const positive = await checkConsumer(`import { create, Store, Status, type Model, type Patch } from './api.js';
const model: Model = create('ok', 1);
const value: number = model.value;
const result: string = new Store<string>('ok').get();
const patch: Patch = { value: 1 };
const status: Status = Status.Ready;
`)
  assert.equal(positive.code, 0, positive.diagnostics)
  const negative = await checkConsumer(`import { create, Store } from './api.js';
const wrong: string = create('ok', 1).value;
const bad: number = new Store<string>('ok').get();
`)
  const errors = [...negative.diagnostics.matchAll(/error TS(\d+):/g)].map(match => match[1])
  assert.notEqual(negative.code, 0, 'Invalid assignments must be rejected')
  assert.deepEqual(errors, ['2322', '2322'], negative.diagnostics)
  console.log(`Qualified packaged ${slug} library: native FFI, strict consumer, two TS2322 controls`)
}
finally {
  await rm(directory, { recursive: true, force: true })
}

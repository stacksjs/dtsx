import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'

// Regression: https://github.com/stacksjs/dtsx/issues/3149
// Root builds the real binary before running this suite. No build or library
// binding runs here, and an absent selected binary is a failure.
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
const unsupported = 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { privateValue = undefined; } export const value = privateValue;'

async function invoke(args: string[], source = ''): Promise<{ code: number, stdout: string, stderr: string }> {
  expect(existsSync(cli), `Build the actual native CLI before this suite: ${cli}`).toBe(true)
  const child = Bun.spawn([cli, ...args], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', timeout: 4000 })
  await child.stdin.write(source)
  await child.stdin.end()
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

async function withDirectory(check: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'zig-dtsx-cli-failure-'))
  try { await check(directory) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('standalone CLI reports its own compiler, target and optimization without input', async () => {
  const result = await invoke(['--build-info'])
  expect(result.code, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  const info = JSON.parse(result.stdout)
  expect(info.tool).toBe('dtsx')
  expect(info.zig).toMatch(/^\d+\.\d+\.\d+/)
  expect(info.arch).toBe(process.arch === 'arm64' ? 'aarch64' : 'x86_64')
  expect(info.os).toBe(process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform)
  expect(typeof info.optimization).toBe('string')
  expect(info.optimization.length).toBeGreaterThan(0)
})

test('standalone CLI flow input has valid authored strict typing and an effective negative', () => withDirectory(async (directory) => {
  expect(isAvailable).toBe(true)
  await writeFile(join(directory, 'index.ts'), unsupported)
  await writeFile(join(directory, 'consumer.ts'), "import { value } from './index.js'; const valid: number | undefined = value; void valid;")
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
  const positive = runTsc(directory, ['--project', 'tsconfig.json'])
  expect(positive.ok, positive.output).toBe(true)
  await writeFile(join(directory, 'consumer.ts'), "import { value } from './index.js'; const invalid: null = value; void invalid;")
  const negative = runTsc(directory, ['--project', 'tsconfig.json'])
  expect(negative.ok, negative.output).toBe(false)
  expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
}))

test('standalone stdin receives nonempty source and emits its declaration', async () => {
  const result = await invoke([], 'export const stdinCanary: number = 7;')
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toContain('export declare const stdinCanary: number;')
})

test('standalone stdin emission reports unsupported flow with nonzero status', async () => {
  const result = await invoke([], unsupported)
  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('DTSX_UNSUPPORTED_VALUE_FLOW')
})

test('standalone file emission fails before replacing the prior destination', () => withDirectory(async (directory) => {
  const input = join(directory, 'index.ts')
  const output = join(directory, 'index.d.ts')
  const prior = 'export declare const prior: unique symbol;\n'
  await writeFile(input, unsupported)
  await writeFile(output, prior)
  const result = await invoke([input, '-o', output])
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('DTSX_UNSUPPORTED_VALUE_FLOW')
  expect(await readFile(output, 'utf8')).toBe(prior)
}))

for (const count of [1, 17]) {
  test(`standalone ${count}-file project propagates a worker emission failure`, () => withDirectory(async (directory) => {
    const input = join(directory, 'src')
    const output = join(directory, 'dist')
    await mkdir(input)
    await mkdir(output)
    await writeFile(join(input, 'failed.ts'), unsupported)
    for (let index = 1; index < count; index++) await writeFile(join(input, `healthy${index}.ts`), `export const healthy${index}: number = ${index};`)
    const prior = 'export declare const prior: unique symbol;\n'
    await writeFile(join(output, 'failed.d.ts'), prior)
    await writeFile(join(output, 'runtime.js'), 'export const runtime = 7;\n')
    const result = await invoke(['--project', input, '--outdir', output])
    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('DTSX_UNSUPPORTED_VALUE_FLOW')
    expect(await readFile(join(output, 'failed.d.ts'), 'utf8')).toBe(prior)
    expect(await readFile(join(output, 'runtime.js'), 'utf8')).toBe('export const runtime = 7;\n')
    // Successful siblings may already have published in this legacy mode.
    // This test does not certify all-project rollback or graph delivery.
  }))
}

test('standalone project reports an unreadable source instead of skipping it', () => withDirectory(async (directory) => {
  const input = join(directory, 'src')
  const output = join(directory, 'dist')
  await mkdir(input)
  await mkdir(output)
  await symlink(join(directory, 'missing.ts'), join(input, 'missing.ts'))
  const result = await invoke(['--project', input, '--outdir', output])
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('InputReadFailure')
  expect(await Bun.file(join(output, 'missing.d.ts')).exists()).toBe(false)
}))

test('standalone project reports a destination conflict instead of skipping it', () => withDirectory(async (directory) => {
  const input = join(directory, 'src')
  const output = join(directory, 'dist')
  await mkdir(input)
  await mkdir(output)
  await writeFile(join(input, 'healthy.ts'), 'export const healthy: number = 1;')
  await mkdir(join(output, 'healthy.d.ts'))
  const result = await invoke(['--project', input, '--outdir', output])
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('OutputWriteFailure')
}))

test('standalone valid empty declarations remain distinct from failure', () => withDirectory(async (directory) => {
  const stdin = await invoke([])
  expect(stdin.code, stdin.stderr).toBe(0)
  expect(stdin.stdout).toBe('\n')
  const input = join(directory, 'src')
  const output = join(directory, 'dist')
  await mkdir(input)
  await mkdir(output)
  await writeFile(join(input, 'empty.ts'), '')
  const project = await invoke(['--project', input, '--outdir', output])
  expect(project.code, project.stderr).toBe(0)
  expect(await readFile(join(output, 'empty.d.ts'), 'utf8')).toBe('\n')
}))

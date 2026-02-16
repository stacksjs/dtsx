#!/usr/bin/env bun
/**
 * Profile script: measures timing breakdown for dtsx --project with 500 files
 * and compares against raw I/O baselines (async read, sync read, async write, sync write).
 *
 * Note: The "bun cli.ts" test is skipped for >=200 files because --project
 * spawns workers via process.execPath which only works with the compiled binary.
 */
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const FILE_COUNT = 500
const DTSX_BIN = join(import.meta.dir, '..', 'packages', 'dtsx', 'bin', 'dtsx')

// Template content — matches the benchmark style
const TEMPLATE = `\
export interface Config { name: string; value: number; }
export function getValue(config: Config): number { return config.value; }
export const DEFAULT_VALUE: number = 42;
export type ConfigKey = keyof Config;
`

// Variations to make files slightly different
function fileContent(i: number): string {
  return `${TEMPLATE}
export interface Item${i} { id: number; label: string; }
export function process${i}(item: Item${i}): string { return item.label; }
export const MAGIC_${i}: number = ${i};
export type Key${i} = keyof Item${i};
`
}

function hr() {
  console.log('\u2500'.repeat(64))
}

function fmt(ms: number): string {
  return `${ms.toFixed(2)} ms`
}

// Setup
const baseDir = join(tmpdir(), `dtsx-profile-${Date.now()}`)
const srcDir = join(baseDir, 'src')
const outDir = join(baseDir, 'out')

mkdirSync(srcDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

console.log(`\nProfiling dtsx --project with ${FILE_COUNT} files`)
console.log(`Temp directory: ${srcDir}\n`)

const fileNames: string[] = []
for (let i = 0; i < FILE_COUNT; i++) {
  const name = `module_${String(i).padStart(4, '0')}.ts`
  fileNames.push(name)
  writeFileSync(join(srcDir, name), fileContent(i))
}

const avgSize = Buffer.byteLength(fileContent(250))
console.log(`Setup complete. ${FILE_COUNT} files, avg ~${avgSize} bytes each\n`)
hr()

// 1. dtsx --project (compiled binary)
{
  console.log('\n[1] dtsx --project (compiled binary, 500 files)')
  const t0 = Bun.nanoseconds()
  const result = spawnSync(DTSX_BIN, ['--project', srcDir, '--outdir', outDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const elapsed = (Bun.nanoseconds() - t0) / 1e6
  const outFiles = readdirSync(outDir).filter(f => f.endsWith('.d.ts'))
  console.log(`    Time:         ${fmt(elapsed)}`)
  console.log(`    Output files: ${outFiles.length}`)
  if (result.status !== 0 && result.stderr?.length) {
    console.log(`    stderr:       ${result.stderr.toString().trim().slice(0, 300)}`)
  }
  hr()
}

// 2. Read 500 files -- Bun.file().text() + Promise.all
{
  console.log('\n[2] Read 500 files -- Bun.file().text() via Promise.all')
  const paths = fileNames.map(f => join(srcDir, f))
  const t0 = Bun.nanoseconds()
  const contents = await Promise.all(paths.map(p => Bun.file(p).text()))
  const elapsed = (Bun.nanoseconds() - t0) / 1e6
  console.log(`    Time:         ${fmt(elapsed)}`)
  console.log(`    Total bytes:  ${contents.reduce((s, c) => s + c.length, 0)}`)
  hr()
}

// 3. Read 500 files -- readFileSync
{
  console.log('\n[3] Read 500 files -- readFileSync (synchronous)')
  const paths = fileNames.map(f => join(srcDir, f))
  const t0 = Bun.nanoseconds()
  const contents: string[] = []
  for (const p of paths) {
    contents.push(readFileSync(p, 'utf-8'))
  }
  const elapsed = (Bun.nanoseconds() - t0) / 1e6
  console.log(`    Time:         ${fmt(elapsed)}`)
  console.log(`    Total bytes:  ${contents.reduce((s, c) => s + c.length, 0)}`)
  hr()
}

// 4. Write 500 files -- Bun.write() + Promise.all
{
  console.log('\n[4] Write 500 files -- Bun.write() via Promise.all')
  const writeDir = join(baseDir, 'write-async')
  mkdirSync(writeDir, { recursive: true })
  const t0 = Bun.nanoseconds()
  await Promise.all(fileNames.map((f, i) => Bun.write(join(writeDir, f), fileContent(i))))
  const elapsed = (Bun.nanoseconds() - t0) / 1e6
  const count = readdirSync(writeDir).length
  console.log(`    Time:         ${fmt(elapsed)}`)
  console.log(`    Files written: ${count}`)
  hr()
}

// 5. Write 500 files -- writeFileSync
{
  console.log('\n[5] Write 500 files -- writeFileSync (synchronous)')
  const writeDir = join(baseDir, 'write-sync')
  mkdirSync(writeDir, { recursive: true })
  const t0 = Bun.nanoseconds()
  for (let i = 0; i < FILE_COUNT; i++) {
    writeFileSync(join(writeDir, fileNames[i]), fileContent(i))
  }
  const elapsed = (Bun.nanoseconds() - t0) / 1e6
  const count = readdirSync(writeDir).length
  console.log(`    Time:         ${fmt(elapsed)}`)
  console.log(`    Files written: ${count}`)
  hr()
}

// Summary table
console.log('\n  SUMMARY')
console.log('  -------')
console.log('  dtsx --project does: read files + process/transform + write files')
console.log('  The I/O baselines above show how much time is pure I/O vs processing.')
console.log('')

// Cleanup
rmSync(baseDir, { recursive: true, force: true })
console.log('(Cleaned up temp directory)\n')

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfig, resetConfig } from '../src/config'

const tempDirectories: string[] = []

afterEach(async () => {
  resetConfig()
  await Promise.all(tempDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function createProject(name: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), `dtsx-config-${name}-`))
  tempDirectories.push(cwd)
  await mkdir(join(cwd, 'src'))
  await writeFile(join(cwd, 'dtsx.config.ts'), `export default { outdir: '${name}-dist' }\n`)
  return cwd
}

describe('getConfig', () => {
  it('isolates cached configuration by project directory', async () => {
    const firstCwd = await createProject('first')
    const secondCwd = await createProject('second')

    const [first, second] = await Promise.all([getConfig(firstCwd), getConfig(secondCwd)])

    expect(first.cwd).toBe(firstCwd)
    expect(first.outdir).toBe('first-dist')
    expect(second.cwd).toBe(secondCwd)
    expect(second.outdir).toBe('second-dist')
  })

  it('deduplicates concurrent loads for the same project', async () => {
    const cwd = await createProject('shared')

    const [first, second] = await Promise.all([getConfig(cwd), getConfig(cwd)])

    expect(first).toBe(second)
  })

  it('uses the requested directory for fallback configuration', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-config-fallback-'))
    tempDirectories.push(cwd)

    const loaded = await getConfig(cwd)

    expect(loaded.cwd).toBe(cwd)
  })
})

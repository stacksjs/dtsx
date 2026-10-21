import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverWorkspaceProjects } from '../src/workspace'

describe('workspace JSONC discovery', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dtsx-workspace-jsonc-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  test('preserves URL and glob strings while discovering referenced projects', async () => {
    await mkdir(join(directory, 'child'))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'parent' }))
    await writeFile(join(directory, 'child/package.json'), JSON.stringify({ name: 'child' }))
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: 'https://example.com/types', paths: { '@app/*': ['./src/*'] } },
      references: [{ path: './child' }],
    }))
    await writeFile(join(directory, 'child/tsconfig.json'), JSON.stringify({ compilerOptions: { rootDir: './source', outDir: './types' }, include: ['source/**/*.ts'] }))
    const projects = await discoverWorkspaceProjects(join(directory, 'tsconfig.json'))
    expect(projects.map(project => project.name)).toEqual(['child', 'parent'])
    expect(projects[0]!.config).toEqual({ root: './source', outdir: './types' })
    expect(projects[1]!.references).toEqual(['child'])
  })

  test.each(['\n', '\r', '\r\n'])('accepts comments and trailing commas with %j line endings', async (lineEnding) => {
    await mkdir(join(directory, 'child'))
    await writeFile(join(directory, 'tsconfig.json'), `{
      /* project graph */
      "references": [{"path": "./child",},], // dependency
      "compilerOptions": {"rootDir": "./src",},
    }`.replace(/\n/g, lineEnding))
    await writeFile(join(directory, 'child/tsconfig.json'), '{"compilerOptions":{"outDir":"./types",},}')
    const projects = await discoverWorkspaceProjects(join(directory, 'tsconfig.json'))
    expect(projects).toHaveLength(2)
    expect(projects[0]!.root).toBe(join(directory, 'child'))
    expect(projects[0]!.config?.outdir).toBe('./types')
    expect(projects[1]!.references).toEqual([projects[0]!.name])
  })
})

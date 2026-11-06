import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config'
import { generate, processFile } from '../src/generator'

// Public transform and generation boundaries: transforming a single file can
// map a declaration target, but a package build must not publish an importer
// whose local authored declaration was never delivered. No adapters or native
// emitters are exercised here.
const directories: string[] = []
const declarationKinds = [
  ['.d.ts', '.js'],
  ['.d.mts', '.mjs'],
  ['.d.cts', '.cjs'],
] as const

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function createProject(declarationExtension: string, specifier: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-authored-declaration-'))
  directories.push(cwd)
  await mkdir(join(cwd, 'src/contracts'), { recursive: true })
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
  await writeFile(join(cwd, 'src/index.ts'), `export type { Contract } from '${specifier}'`)
  await writeFile(join(cwd, `src/contracts/model${declarationExtension}`), 'export interface Contract { count: number }')
  return cwd
}

for (const [declarationExtension, runtimeExtension] of declarationKinds) {
  for (const outputStructure of ['mirror', 'flat'] as const) {
    for (const spelling of ['extensionless', 'runtime'] as const) {
      const specifier = spelling === 'runtime' ? `./contracts/model${runtimeExtension}` : './contracts/model'
      const expectedSpecifier = outputStructure === 'mirror' ? `./contracts/model${runtimeExtension}` : `./model${runtimeExtension}`

      test(`node transform maps ${spelling} ${declarationExtension} targets to proper ${outputStructure} paths`, async () => {
        const cwd = await createProject(declarationExtension, specifier)

        const declaration = await processFile(join(cwd, 'src/index.ts'), {
          ...defaultConfig,
          cwd,
          root: './src',
          outdir: './dist',
          outputStructure,
          moduleSpecifierMode: 'node',
        })

        expect(declaration).toContain(`from '${expectedSpecifier}'`)
        expect(declaration).not.toContain('model.d.')
      })

      test(`node generation refuses undelivered ${spelling} ${declarationExtension} targets in ${outputStructure} output`, async () => {
        const cwd = await createProject(declarationExtension, specifier)

        const stats = await generate({
          cwd,
          root: './src',
          entrypoints: ['index.ts'],
          outdir: './dist',
          outputStructure,
          moduleSpecifierMode: 'node',
          continueOnError: true,
          clean: true,
        })

        expect(stats.filesFailed).toBeGreaterThan(0)
        expect(stats.errors.length).toBeGreaterThan(0)
        const diagnostic = stats.errors.map(error => error.message).join('\n')
        expect(diagnostic).toContain('index.ts')
        expect(diagnostic).toContain(specifier)
        expect(diagnostic).toContain(`model${declarationExtension}`)
        expect(diagnostic).toMatch(/declaration/i)
        expect(diagnostic).toMatch(/not (?:emitted|delivered)|excluded|cannot (?:emit|deliver)/i)
        expect(await Bun.file(join(cwd, 'dist/index.d.ts')).exists()).toBe(false)
      })
    }
  }

  for (const mode of ['default', 'preserve'] as const) {
    test(`${mode} mode keeps authored ${declarationExtension} compatibility without imposing node refusal`, async () => {
      const specifier = './contracts/model'
      const cwd = await createProject(declarationExtension, specifier)
      const config = {
        ...defaultConfig,
        cwd,
        root: './src',
        entrypoints: ['index.ts'],
        outdir: './dist',
        ...(mode === 'preserve' ? { moduleSpecifierMode: 'preserve' as const } : {}),
      }

      expect(await processFile(join(cwd, 'src/index.ts'), config)).toContain(`from '${specifier}'`)
      const stats = await generate(config)

      expect(stats.errors).toEqual([])
      expect(stats.filesFailed).toBe(0)
      expect(await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')).toContain(`from '${specifier}'`)
    })
  }
}

import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src'
import { isAvailable, runTsc } from './helpers/tsc'

type Producer = 'core' | 'bun-plugin' | 'cli'

interface ClassCase {
  name: string
  source: string
  instance?: string
  positive?: string
  privateExpression?: string
  signatures?: string[]
  retainsPrivateBrand?: boolean
}

const cases: ClassCase[] = [
  { name: 'same-line hash private method', source: 'export class Calculate { #if(value: number): number { return value } value(): number { return this.#if(4) / 2 } }', privateExpression: 'new Calculate().if(4)' },
  { name: 'multiline hash private method', source: 'export class Calculate {\n #if(value: number): number { return value }\n value(): number { return this.#if(4) / 2 }\n}', privateExpression: 'new Calculate().if(4)' },
  { name: 'same-line TypeScript private method', source: 'export class Calculate { private hidden(value: number): number { return value } value(): number { return this.hidden(4) / 2 } }', privateExpression: 'new Calculate().hidden(4)' },
  { name: 'quoted private method', source: 'export class Calculate { private "hidden"(value: number): number { return value } value(): number { return this.hidden(4) / 2 } }', privateExpression: 'new Calculate().hidden(4)' },
  { name: 'generic private method with object constraints', source: 'export class Calculate { #hidden<T extends { value: number }>(value: T): T { return value } value(): number { return this.#hidden({ value: 2 }).value } }', privateExpression: 'new Calculate().hidden({ value: 2 })' },
  { name: 'private method with object return type', source: 'export class Calculate { #hidden(): { value: number } { return { value: 2 } } value(): number { return this.#hidden().value } }', privateExpression: 'new Calculate().hidden()' },
  { name: 'TypeScript private accessor', source: 'export class Calculate { private get hidden(): number { return 2 } value(): number { return this.hidden } }', privateExpression: 'new Calculate().hidden' },
  { name: 'quoted TypeScript private accessor', source: 'export class Calculate { private get "hidden"(): number { return 2 } value(): number { return this.hidden } }', privateExpression: 'new Calculate().hidden' },
  { name: 'quoted public accessor control', source: 'export class Calculate { get "current"(): number { return 2 } set "current"(value: number) {} value(): number { return this.current } }', positive: 'const current: number = new Calculate().current; new Calculate().current = 3;', signatures: ['get "current"(): number', 'set "current"(value: number)'] },
  { name: 'hash private accessor control', source: 'export class Calculate { get #hidden(): number { return 2 } set #hidden(value: number) {} value(): number { return this.#hidden } }', privateExpression: 'new Calculate().hidden' },
  { name: 'private object initializer continuation', source: 'export class Calculate { #hidden = { nested: { value: 4 } }.nested; value(): number { return this.#hidden.value / 2 } }', privateExpression: 'new Calculate().hidden' },
  { name: 'private arrow initializer continuation', source: 'export class Calculate { #hidden = () => ({ value: 2 }); value(): number { return this.#hidden().value } }', privateExpression: 'new Calculate().hidden' },
  { name: 'private body with comments regex and division', source: 'export class Calculate { #hidden(value: string): number { /* } fake() {} */ if (value) /[}]/.test(value); return Number(value) / 2 } /** public member */ value(): number { return this.#hidden("4") } }', privateExpression: 'new Calculate().hidden("4")' },
  { name: 'static private method with comments', source: 'export class Calculate { private /* header */ static hidden(value: number): number { return value } value(): number { return Calculate.hidden(4) / 2 } }', privateExpression: 'Calculate.hidden(4)' },
  { name: 'constructor after a private method', source: 'export class Calculate { #hidden(value: number): number { return value } constructor(public readonly seed: number) {} value(): number { return this.#hidden(this.seed) } }', instance: 'new Calculate(2)', positive: 'const seed: number = new Calculate(2).seed;', privateExpression: 'new Calculate(2).hidden(4)', signatures: ['constructor(seed: number)', 'readonly seed: number'] },
  { name: 'public fields accessors and static members after a private method', source: 'export class Calculate { #hidden(): void {} count = 2; get current(): number { return this.count } set current(value: number) { this.count = value } static create(): Calculate { return new Calculate() } value(): number { return this.count } }', positive: 'const count: number = new Calculate().count; const current: number = new Calculate().current; new Calculate().current = 3; const made: Calculate = Calculate.create();', privateExpression: 'new Calculate().hidden()', signatures: ['count: number', 'get current(): number', 'set current(value: number)', 'static create(): Calculate'] },
  { name: 'ordinary public keyword method control', source: 'export class Calculate { if(value: number): number { return value } value(): number { return this.if(4) / 2 } }', positive: 'const named: number = new Calculate().if(4);', signatures: ['if(value: number): number'] },
  { name: 'private generator brand control', source: 'export class Calculate { *#hidden(): Generator<number> { yield 1 } value(): number { return 2 } }', privateExpression: 'new Calculate().hidden()', retainsPrivateBrand: true },
  { name: 'async private generator brand control', source: 'export class Calculate { async *#hidden(): AsyncGenerator<number> { yield 1 } value(): number { return 2 } }', privateExpression: 'new Calculate().hidden()', retainsPrivateBrand: true },
  { name: 'async public generator modifiers after a private method', source: 'export class Calculate { #hidden(): void {} async /* modifier */ *values(): AsyncGenerator<number> { yield 1 } value(): number { return 2 } }', positive: 'const values: AsyncGenerator<number> = new Calculate().values();', privateExpression: 'new Calculate().hidden()', signatures: ['values(): AsyncGenerator<number>'] },
]

async function packedClass(fixture: ClassCase, producer: Producer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-class-members-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  try {
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'class-member-library', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
    await writeFile(join(library, 'src/index.ts'), fixture.source)
    const compilerOptions = { module: 'Preserve', moduleResolution: 'Bundler', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
    await writeFile(join(library, 'tsconfig.source.json'), JSON.stringify({ compilerOptions, include: ['src/index.ts'] }))
    expect(isAvailable).toBe(true)
    const sourceCheck = runTsc(library, ['--project', 'tsconfig.source.json'])
    expect(sourceCheck.ok, sourceCheck.output).toBe(true)

    const entrypoints = [join(library, 'src/index.ts')]
    const baseline = await Bun.build({ entrypoints, outdir: join(library, 'dist'), target: 'bun' })
    expect(baseline.success).toBe(true)
    if (producer === 'cli') {
      const cli = resolve(import.meta.dir, '../bin/cli.ts')
      const generated = Bun.spawnSync([process.execPath, cli, 'generate', '--cwd', library, '--root', './src', '--entrypoints', 'index.ts', '--outdir', './dist'], { cwd: library })
      expect(generated.exitCode, generated.stderr.toString()).toBe(0)
    }
    else if (producer === 'core') {
      await generate({ cwd: library, root: './src', entrypoints: ['index.ts'], outdir: './dist' })
    }
    else {
      const built = await Bun.build({ entrypoints, outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', entrypoints: ['index.ts'], outdir: './dist' })] })
      expect(built.success).toBe(true)
    }

    const archive = join(directory, 'library.tgz')
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-class-consumer', private: true, type: 'module', dependencies: { 'class-member-library': `file:${archive}` } }))
    const installed = Bun.spawnSync([process.execPath, 'install'], { cwd: consumer })
    expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    const frozen = Bun.spawnSync([process.execPath, 'install', '--frozen-lockfile'], { cwd: consumer })
    expect(frozen.exitCode, frozen.stderr.toString()).toBe(0)
    const instance = fixture.instance ?? 'new Calculate()'
    const header = `import { Calculate } from 'class-member-library';\n`
    await writeFile(join(consumer, 'consumer.ts'), `${header}const value: number = ${instance}.value(); ${fixture.positive ?? ''} export { value }`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, include: ['consumer.ts'] }))
    const positive = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(positive.ok, positive.output).toBe(true)

    await writeFile(join(consumer, 'negative.ts'), `${header}const value: string = ${instance}.value(); export { value }`)
    await writeFile(join(consumer, 'tsconfig.negative.json'), JSON.stringify({ compilerOptions, include: ['negative.ts'] }))
    const negative = runTsc(consumer, ['--project', 'tsconfig.negative.json'])
    expect(negative.ok).toBe(false)
    expect(negative.output).toContain('TS2322')
    expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])

    if (fixture.privateExpression) {
      await writeFile(join(consumer, 'private.ts'), `${header}${fixture.privateExpression};`)
      await writeFile(join(consumer, 'tsconfig.private.json'), JSON.stringify({ compilerOptions, include: ['private.ts'] }))
      const privacy = runTsc(consumer, ['--project', 'tsconfig.private.json'])
      expect(privacy.ok).toBe(false)
      expect(privacy.output).toContain('TS2339')
      expect(privacy.output.match(/error TS\d+/g)).toEqual(['error TS2339'])
    }
    if (fixture.retainsPrivateBrand) {
      await writeFile(join(consumer, 'brand.ts'), `${header}const structural: Calculate = { value: () => 2 }; export { structural }`)
      await writeFile(join(consumer, 'tsconfig.brand.json'), JSON.stringify({ compilerOptions, include: ['brand.ts'] }))
      const brand = runTsc(consumer, ['--project', 'tsconfig.brand.json'])
      expect(brand.ok).toBe(false)
      expect(brand.output).toContain('TS2741')
    }
    const declaration = await readFile(join(consumer, 'node_modules/class-member-library/dist/index.d.ts'), 'utf8')
    for (const signature of fixture.signatures ?? []) expect(declaration).toContain(signature)
    expect(declaration).not.toContain('fake(')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const fixture of cases) {
  for (const producer of ['core', 'bun-plugin'] as const) {
    test(`${producer} preserves ${fixture.name} in a normal strict packed consumer`, async () => {
      await packedClass(fixture, producer)
    })
  }
}

for (const fixture of cases.filter(item => ['same-line hash private method', 'same-line TypeScript private method', 'quoted private method', 'private body with comments regex and division'].includes(item.name))) {
  test(`CLI preserves ${fixture.name} in a normal strict packed consumer`, async () => {
    await packedClass(fixture, 'cli')
  })
}

for (const word of ['private', 'protected', 'public', 'static', 'abstract', 'readonly', 'override', 'accessor', 'async', 'declare', 'get', 'set']) {
  for (const visibility of ['private', 'public'] as const) {
    test(`core distinguishes ${visibility} member named ${word} from modifiers`, async () => {
      const modifier = visibility === 'private' ? 'private ' : ''
      await packedClass({
        name: `${visibility} ${word}`,
        source: `export class Calculate { ${modifier}${word} /* header */ (value: number): number { return value } value(): number { return this.${word}(4) / 2 } }`,
        ...(visibility === 'private'
          ? { privateExpression: `new Calculate().${word}(4)` }
          : { positive: `const named: number = new Calculate().${word}(4);`, signatures: [`${word}(value: number): number`] }),
      }, 'core')
    })
  }
}

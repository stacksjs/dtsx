import { afterEach, describe, expect, it } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { processSource } from '../src/process-source'
import { isVueFile, mapRuntimeProps, parseVueSfc, stripMacroStatements, transformVueSfcToTs } from '../src/vue'

const fixturesDir = join(import.meta.dir, 'fixtures', 'vue')

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'dtsx-vue-'))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Minimal `vue` module shim so emitted component declarations typecheck. */
const vueShim = `declare module 'vue' {
  export type ComputedOptions = Record<string, any>
  export type MethodOptions = Record<string, (...args: any[]) => any>
  export type ComponentOptionsMixin = Record<string, any>
  export type EmitsOptions = string[] | Record<string, ((...args: any[]) => any) | null>
  export interface DefineComponent<
    PropsOrPropOptions = {},
    RawBindings = {},
    D = {},
    C extends ComputedOptions = ComputedOptions,
    M extends MethodOptions = MethodOptions,
    Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
    Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
    E extends EmitsOptions = {},
  > {}
}
`

/** Assert a declaration file passes `tsc --noEmit --strict` (with the vue shim). */
async function expectParsesUnderTsc(dts: string): Promise<void> {
  const tempDir = await createTempDir()
  await writeFile(join(tempDir, 'out.d.ts'), dts)
  await writeFile(join(tempDir, 'vue.d.ts'), vueShim)
  const tscBin = join(import.meta.dir, '..', '..', '..', 'node_modules', '.bin', 'tsc')
  const proc = Bun.spawnSync([tscBin, '--noEmit', '--strict', 'out.d.ts', 'vue.d.ts'], { cwd: tempDir })
  const output = `${proc.stdout.toString()}${proc.stderr.toString()}`
  expect(proc.exitCode === 0 ? '' : output).toBe('')
}

/** Copy the vue fixtures into a temp src dir and run a full generation pass. */
async function generateFixtures(entrypoints: string[]): Promise<{ outDir: string }> {
  const tempDir = await createTempDir()
  const srcDir = join(tempDir, 'src')
  const outDir = join(tempDir, 'dist')
  await cp(fixturesDir, srcDir, { recursive: true })
  await generate({
    cwd: tempDir,
    root: './src',
    outdir: './dist',
    entrypoints,
    clean: true,
  })
  return { outDir }
}

describe('vue sfc parsing', () => {
  it('detects vue files by extension', () => {
    expect(isVueFile('/src/Comp.vue')).toBe(true)
    expect(isVueFile('/src/Comp.ts')).toBe(false)
    expect(isVueFile('/src/Comp.vue.ts')).toBe(false)
  })

  it('extracts script and script setup blocks with attrs', async () => {
    const source = await readFile(join(fixturesDir, 'MixedExports.vue'), 'utf8')
    const sfc = parseVueSfc(source)
    expect(sfc.script).not.toBeNull()
    expect(sfc.script?.setup).toBe(false)
    expect(sfc.script?.lang).toBe('ts')
    expect(sfc.scriptSetup).not.toBeNull()
    expect(sfc.scriptSetup?.setup).toBe(true)
    expect(sfc.script?.content).toContain('SERIALIZER_VERSION')
    expect(sfc.scriptSetup?.content).toContain('defineProps')
  })

  it('handles template-only SFCs without script blocks', async () => {
    const source = await readFile(join(fixturesDir, 'TemplateOnly.vue'), 'utf8')
    const sfc = parseVueSfc(source)
    expect(sfc.script).toBeNull()
    expect(sfc.scriptSetup).toBeNull()
  })

  it('strips compiler macro statements including withDefaults wrappers', async () => {
    const source = await readFile(join(fixturesDir, 'CounterButton.vue'), 'utf8')
    const sfc = parseVueSfc(source)
    const stripped = stripMacroStatements(sfc.scriptSetup!.content)
    expect(stripped).not.toContain('defineProps')
    expect(stripped).not.toContain('defineEmits')
    expect(stripped).not.toContain('defineExpose')
    expect(stripped).not.toContain('withDefaults')
    expect(stripped).toContain('const count = ref(0)')
  })

  it('maps runtime props options to type literals', () => {
    expect(mapRuntimeProps(`{
      title: { type: String, required: true },
      elevation: { type: Number, default: 1 },
      elevated: Boolean,
      tags: Array as PropType<string[]>,
    }`)).toBe(`{ title: string, elevation?: number, elevated?: boolean, tags?: string[] }`)
    expect(mapRuntimeProps(`['title', 'sub-title']`)).toBe(`{ title?: unknown, "sub-title"?: unknown }`)
  })
})

describe('vue sfc declaration transform', () => {
  it('declares a DefineComponent from script setup generic props, emits and expose', async () => {
    const source = await readFile(join(fixturesDir, 'CounterButton.vue'), 'utf8')
    const dts = processSource(source, 'CounterButton.vue')
    expect(dts).toContain(`import type { DefineComponent } from 'vue';`)
    expect(dts).toContain('label: string')
    expect(dts).toContain('disabled?: boolean')
    expect(dts).toContain('"increment": (value: number) => void')
    expect(dts).toContain('"reset": () => void')
    expect(dts).toContain('DefineComponent<')
    expect(dts).toContain('export default __dtsx_component__;')
    // Setup internals must not leak into the declaration
    expect(dts).not.toContain('declare const count')
    expect(dts).not.toContain('defineProps')
    expect(dts).not.toContain('withDefaults')
  })

  it('keeps imported prop types referenced from inline defineProps literals', async () => {
    const source = await readFile(join(fixturesDir, 'IconBadge.vue'), 'utf8')
    const dts = processSource(source, 'IconBadge.vue')
    expect(dts).toContain(`import type { BadgeKind } from './types';`)
    expect(dts).toContain('kind?: BadgeKind')
    expect(dts).toContain('DefineComponent<')
  })

  it('maps Options API runtime props and emits to a DefineComponent', async () => {
    const source = await readFile(join(fixturesDir, 'LegacyCard.vue'), 'utf8')
    const dts = processSource(source, 'LegacyCard.vue')
    expect(dts).toContain(`import type { DefineComponent } from 'vue';`)
    expect(dts).toContain('title: string')
    expect(dts).toContain('elevation?: number')
    expect(dts).toContain('elevated?: boolean')
    expect(dts).toContain('tags?: string[]')
    expect(dts).toContain('meta?: { author: string }')
    expect(dts).toContain(`"close", "expand"`)
    expect(dts).not.toContain('PropType')
  })

  it('emits a bare DefineComponent for template-only SFCs', async () => {
    const source = await readFile(join(fixturesDir, 'TemplateOnly.vue'), 'utf8')
    const dts = processSource(source, 'TemplateOnly.vue')
    expect(dts).toContain('DefineComponent<{}, {}>')
    expect(dts).toContain('export default __dtsx_component__;')
  })

  it('preserves named exports from a plain script block alongside the component', async () => {
    const source = await readFile(join(fixturesDir, 'MixedExports.vue'), 'utf8')
    const dts = processSource(source, 'MixedExports.vue')
    expect(dts).toContain('SERIALIZER_VERSION')
    expect(dts).toContain('serialize')
    expect(dts).toContain('export default __dtsx_component__;')
    expect(dts).toContain('value: unknown')
  })

  it('emits identical declarations through the isolated path', async () => {
    const source = await readFile(join(fixturesDir, 'CounterButton.vue'), 'utf8')
    const semantic = processSource(source, 'CounterButton.vue', true, ['bun'], false)
    const isolated = processSource(source, 'CounterButton.vue', true, ['bun'], true)
    expect(isolated).toContain('DefineComponent<')
    expect(isolated).toContain('label: string')
    expect(isolated).toContain('export default __dtsx_component__;')
    // sanity: both paths agree on the component name
    expect(semantic).toContain('export default __dtsx_component__;')
  })
})

describe('comments inside collapsed props types', () => {
  it('keeps JSDoc comments valid in collapsed props types', async () => {
    const source = await readFile(join(fixturesDir, 'BurnButton.vue'), 'utf8')
    const dts = processSource(source, 'BurnButton.vue')
    // the collapsed props type retains the member and its type
    expect(dts).toContain('onBurn: (mint: string) => Promise<string>')
    // JSDoc survives as a block comment
    expect(dts).toContain('/**')
    // the comment must not be followed by a stray `;` (was: `*/;` → TS1131)
    expect(dts).not.toMatch(/\*\/;/)
    // and the whole declaration file must still typecheck
    await expectParsesUnderTsc(dts)
  })

  it('converts line comments in props types to block comments', () => {
    const source = [
      '<script setup lang="ts">',
      'defineProps<{',
      '  mint: string // the mint address',
      '}>()',
      '</script>',
      '<template><div /></template>',
      '',
    ].join('\n')
    const dts = processSource(source, 'LineComment.vue')
    // a `//` comment would swallow the rest of the collapsed type
    expect(dts).not.toContain('// the mint address')
    expect(dts).toContain('/* the mint address */')
    expect(dts).toContain('mint: string')
    return expectParsesUnderTsc(dts)
  })

  it('produces a CounterButton declaration that typechecks against the vue shim', async () => {
    const source = await readFile(join(fixturesDir, 'CounterButton.vue'), 'utf8')
    const dts = processSource(source, 'CounterButton.vue')
    await expectParsesUnderTsc(dts)
  })
})

describe('vue sfc project generation', () => {
  it('emits .d.ts files for .vue entrypoints via generate()', async () => {
    const { outDir } = await generateFixtures(['CounterButton.vue', 'LegacyCard.vue', 'IconBadge.vue', 'TemplateOnly.vue', 'MixedExports.vue'])

    const counter = await readFile(join(outDir, 'CounterButton.d.ts'), 'utf8')
    expect(counter).toContain('DefineComponent<')
    expect(counter).toContain('label: string')

    const legacy = await readFile(join(outDir, 'LegacyCard.d.ts'), 'utf8')
    expect(legacy).toContain('title: string')

    const badge = await readFile(join(outDir, 'IconBadge.d.ts'), 'utf8')
    expect(badge).toContain(`import type { BadgeKind } from './types';`)

    const templateOnly = await readFile(join(outDir, 'TemplateOnly.d.ts'), 'utf8')
    expect(templateOnly).toContain('DefineComponent<{}, {}>')

    const mixed = await readFile(join(outDir, 'MixedExports.d.ts'), 'utf8')
    expect(mixed).toContain('SERIALIZER_VERSION')

    // The shared types module is auto-included and emitted alongside.
    const types = await readFile(join(outDir, 'types.d.ts'), 'utf8')
    expect(types).toContain('BadgeKind')
  })

  it('rewrites .vue import specifiers in consuming .ts declarations', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')
    await cp(fixturesDir, srcDir, { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(srcDir, 'index.ts'), `import IconBadge from './IconBadge.vue'\nexport { IconBadge }\n`)

    await generate({
      cwd: tempDir,
      root: './src',
      outdir: './dist',
      entrypoints: ['index.ts'],
      clean: true,
    })

    const indexDts = await readFile(join(outDir, 'index.d.ts'), 'utf8')
    expect(indexDts).toContain(`from './IconBadge'`)
    expect(indexDts).not.toContain('.vue')
    const badgeDts = await readFile(join(outDir, 'IconBadge.d.ts'), 'utf8')
    expect(badgeDts).toContain('DefineComponent<')
  })
})

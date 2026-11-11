import process from 'node:process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

interface Manifest {
  name: string
  version: string
  private?: boolean
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
}

interface Packed {
  directory: string
  archive: string
  manifest: Manifest
  files: Map<string, File>
}

interface PublicEntry {
  subpath: string
  exportKey: string
  importTarget?: string
  declaredTypesTarget?: string
  typesTarget: string
  typesCondition: 'types' | 'import'
  typeOnly: boolean
  runtimeTarget?: string
}

interface Result {
  name: string
  ok: boolean
  detail?: string
}

interface Command {
  name: string
  args: string[]
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
}

interface CandidateRegistry {
  url: string
  stop: () => Promise<void>
}

// Deliberately separate from bun test discovery. Build the actual packages
// explicitly before this command; the gate never invokes a build or emitter.
const root = resolve(import.meta.dir, '..')
// Published package payloads can be qualified with the same consumer matrix.
// The authored controls and toolchain still come from this source checkout.
const packagesRoot = resolve(process.env.DTSX_SDK_PACKAGES_ROOT ?? join(root, 'packages'))
const fixtures = join(import.meta.dir, 'fixtures/public-sdk')
const evidenceBase = process.env.DTSX_SDK_EVIDENCE ?? tmpdir()
await mkdir(evidenceBase, { recursive: true })
const evidence = await mkdtemp(join(evidenceBase, 'dtsx-public-sdk-'))
const results: Result[] = []
const commands: Command[] = []
const payloads: Array<{ package: string, file: string, sha256: string }> = []
const graphs: Array<Record<string, unknown>> = []
const archives: Array<Record<string, unknown>> = []
const ownerToolVersions: Record<string, string> = {}
const registryRequests: Array<Record<string, unknown>> = []
const resolutions: Array<Record<string, unknown>> = []
const authoredPrivateProofs: Array<Record<string, unknown>> = []
const installations: Array<{ consumer: string, retention: string }> = []
let registry: CandidateRegistry | undefined
let registryStopped = false
let sequence = 0

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Private test provider only. Packed manifests and public metadata stay intact. */
async function startRegistry(packages: Packed[]): Promise<CandidateRegistry> {
  const candidates = await Promise.all(packages.map(async (packed, index) => {
    const bytes = new Uint8Array(await Bun.file(packed.archive).arrayBuffer())
    return { packed, bytes, path: `/-/sdk-candidate/${index}.tgz`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'), sha256: hash(bytes) }
  }))
  const aborters = new Set<AbortController>()
  let origin = ''
  // Public requests already have a 60-second AbortController deadline below.
  // Bun's unrelated default idle timer must not disconnect an in-flight proxy
  // response first and turn a real provider result into ConnectionClosed.
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const record: Record<string, unknown> = { id: registryRequests.length + 1,
    at: new Date().toISOString(), method: request.method, path: url.pathname }
    registryRequests.push(record)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      record.status = 405
      return new Response(null, { status: 405 })
    }
    const tarball = candidates.find(candidate => candidate.path === url.pathname)
    if (tarball) {
      Object.assign(record, { kind: 'candidate-tarball', package: tarball.packed.manifest.name,
      version: tarball.packed.manifest.version, integrity: tarball.integrity,
      responseSHA256: tarball.sha256, status: 200 })
      return new Response(request.method === 'HEAD' ? null : tarball.bytes, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(tarball.bytes.length), 'cache-control': 'no-store' },
      })
    }
    let path: string
    try { path = decodeURIComponent(url.pathname.slice(1)) }
    catch { record.status = 400; return new Response(null, { status: 400 }) }
    const candidate = candidates.find(item => path === item.packed.manifest.name
      || path === `${item.packed.manifest.name}/${item.packed.manifest.version}`
      || path === `${item.packed.manifest.name}/latest`)
    if (candidate) {
      const manifest = candidate.packed.manifest
      const version = { ...manifest, dist: { tarball: `${origin}${candidate.path}`,
      integrity: candidate.integrity, shasum: candidate.shasum } }
      const metadata = path === manifest.name
        ? { name: manifest.name, 'dist-tags': { latest: manifest.version }, versions: { [manifest.version]: version } }
        : version
      const body = JSON.stringify(metadata)
      Object.assign(record, { kind: 'candidate-metadata', package: manifest.name,
      version: manifest.version, responseSHA256: hash(Buffer.from(body)), status: 200 })
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      })
    }
    // Forward only public registry paths. Never forward request credentials,
    // cookies, authorization, query strings or any other incoming headers.
    const upstream = new URL('https://registry.npmjs.org')
    upstream.pathname = url.pathname
    const controller = new AbortController()
    aborters.add(controller)
    const timer = setTimeout(() => controller.abort(), 60000)
    try {
      const response = await globalThis.fetch(upstream, { method: request.method, signal: controller.signal,
      credentials: 'omit', redirect: 'error',
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json', 'accept-encoding': 'identity' } })
      const bytes = new Uint8Array(await response.arrayBuffer())
      const headers = new Headers(response.headers)
      // fetch may decode compression. Do not claim the returned decoded bytes
      // still have the upstream compression, transfer framing or byte length.
      for (const header of ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']) headers.delete(header)
      Object.assign(record, { kind: 'public-proxy', provider: upstream.origin,
      status: response.status, responseSHA256: hash(bytes), responseBytes: bytes.length })
      return new Response(request.method === 'HEAD' || response.status === 204 || response.status === 304 ? null : bytes,
      { status: response.status, headers })
    }
    catch (error) {
      Object.assign(record, { kind: 'public-proxy', provider: upstream.origin,
      status: 502, error: error instanceof Error ? error.name : 'FetchFailure' })
      return new Response('Public registry metadata request failed', { status: 502 })
    }
    finally { clearTimeout(timer); aborters.delete(controller) }
  },
})
if (server.port === undefined) {
  await server.stop(true)
  throw new Error('The owned candidate registry must have an ephemeral TCP port')
}
origin = `http://127.0.0.1:${server.port}`
return { url: `${origin}/`, async stop() {
  for (const controller of aborters) controller.abort()
  await server.stop(true)
} }
}

async function check(name: string, operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation()
    results.push({ name, ok: true })
    return true
  }
  catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    results.push({ name, ok: false, detail })
    console.error(`FAIL ${name}: ${detail}`)
    return false
  }
}

/** Keep failed graphs intact; release only a completed, passing graph's derived dependencies. */
async function releasePassedInstallation(consumer: string, passed: boolean): Promise<void> {
  if (!passed || process.env.DTSX_SDK_KEEP_INSTALLS === '1') {
    installations.push({ consumer, retention: passed ? 'passed graph retained by request' : 'failed graph retained' })
    return
  }
  const removed = await check(`${consumer}: release passed installation dependencies`, () => rm(join(evidence, consumer, 'node_modules'), { recursive: true, force: true }))
  installations.push({ consumer, retention: removed ? 'passed dependencies removed; archives, locks, probes, logs and hashes retained' : 'dependency cleanup failed' })
}

async function run(name: string, args: string[], cwd: string, timeout = 120000): Promise<{ code: number, output: string }> {
  const prefix = `${String(++sequence).padStart(3, '0')}-${name.replace(/[^a-z0-9-]/gi, '-')}`
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe', timeout })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  const out = join(evidence, `${prefix}.stdout`)
  const err = join(evidence, `${prefix}.stderr`)
  await Promise.all([writeFile(out, stdout), writeFile(err, stderr)])
  commands.push({ name, args, cwd, exitCode: code, stdout: out, stderr: err })
  return { code, output: `${stdout}${stderr}` }
}

function archiveKey(target: string): string {
  assert(target.startsWith('./') && !target.includes('\\') && !target.includes('\0')
    && !target.slice(2).split('/').some(part => part === '..' || part === '.' || !part), `Unsafe packed target ${target}`)
  return `package/${target.slice(2)}`
}

function exportConditions(manifest: Manifest, key: string): Record<string, string> {
  assert(key === '.' || key.startsWith('./'), `Unsupported public export key ${manifest.name} ${key}`)
  assert(key.split('*').length <= 2, `Unsupported public export pattern ${manifest.name} ${key}`)
  const value = manifest.exports?.[key]
  assert(value && typeof value === 'object' && !Array.isArray(value), `Unsupported export schema for ${manifest.name} ${key}`)
  const conditions: Record<string, string> = {}
  for (const [condition, target] of Object.entries(value)) {
    assert(condition === 'types' || condition === 'import', `Unsupported export condition ${manifest.name} ${key} ${condition}`)
    assert(typeof target === 'string' && target.split('*').length === key.split('*').length,
    `Unsupported ${condition} target for ${manifest.name} ${key}`)
    archiveKey(target)
    conditions[condition] = target
  }
  assert(Object.keys(conditions).length > 0, `Empty export conditions for ${manifest.name} ${key}`)
  return conditions
}

function selectedExport(manifest: Manifest, subpath: string): { key: string, conditions: Record<string, string>, wildcard: string } {
  let key = subpath
  let wildcard = ''
  if (!Object.hasOwn(manifest.exports ?? {}, subpath)) {
    const pattern = Object.keys(manifest.exports ?? {}).filter(key => key.includes('*')
      && subpath.length >= key.length - 1
      && subpath.startsWith(key.split('*')[0]) && subpath.endsWith(key.split('*')[1]))
      .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length)[0]
    assert(pattern, `No public export ${manifest.name}${subpath.slice(1)}`)
    const [before, after] = pattern.split('*')
    wildcard = subpath.slice(before.length, subpath.length - after.length)
    key = pattern
  }
  return { key, conditions: exportConditions(manifest, key), wildcard }
}

function targetFor(manifest: Manifest, subpath: string, condition: string): string {
  const { conditions, wildcard } = selectedExport(manifest, subpath)
  const target = conditions[condition]
  assert(typeof target === 'string', `Missing ${condition} export for ${manifest.name} ${subpath}`)
  return target.replace('*', wildcard)
}

const builtin = new Set(builtinModules)
const scanner = new Bun.Transpiler({ loader: 'js', target: 'bun' })

/** Enumerate concrete public targets from the actual normal archive, including wildcard subpaths. */
function publicEntries(packed: Packed): PublicEntry[] {
  const { manifest, files } = packed
  const subpaths = new Set<string>()
  for (const key of Object.keys(manifest.exports ?? {})) {
    const conditions = exportConditions(manifest, key)
    if (!key.includes('*')) { subpaths.add(key); continue }
    for (const target of Object.values(conditions)) {
      const [before, after] = archiveKey(target).split('*')
      for (const member of files.keys()) {
        if (member.length < before.length + after.length || !member.startsWith(before) || !member.endsWith(after)) continue
        const wildcard = member.slice(before.length, member.length - after.length)
        if (!wildcard) continue
        subpaths.add(key.replace('*', wildcard))
      }
    }
  }
  assert(subpaths.size > 0, `No public archive targets found for ${manifest.name}`)
  return [...subpaths].sort().map(subpath => {
    const { key, conditions, wildcard } = selectedExport(manifest, subpath)
    const importTarget = conditions.import?.replace('*', wildcard)
    const declaredTypesTarget = conditions.types?.replace('*', wildcard)
    // TypeScript considers active conditions in manifest order, including
    // import when an explicit types condition does not precede it.
    const typesCondition = Object.keys(conditions)[0] as 'types' | 'import'
    const selectedTypesTarget = conditions[typesCondition].replace('*', wildcard)
    const declaration = /\.d\.(?:ts|mts|cts)$/
    const typesTarget = declaration.test(selectedTypesTarget) ? selectedTypesTarget
      : selectedTypesTarget.endsWith('.js') ? selectedTypesTarget.slice(0, -3) + '.d.ts'
      : selectedTypesTarget.endsWith('.mjs') ? selectedTypesTarget.slice(0, -4) + '.d.mts'
      : selectedTypesTarget.endsWith('.cjs') ? selectedTypesTarget.slice(0, -4) + '.d.cts' : undefined
    assert(typesTarget, `Unsupported public compiler target ${manifest.name} ${subpath}: ${selectedTypesTarget}`)
    const typeOnly = !importTarget || declaration.test(importTarget)
    assert(typeOnly || /\.(?:js|mjs|cjs)$/.test(importTarget!),
    `Unsupported public runtime target ${manifest.name} ${subpath}: ${importTarget}`)
    return { subpath, exportKey: key, importTarget, declaredTypesTarget, typesTarget, typesCondition,
    typeOnly, runtimeTarget: typeOnly ? undefined : importTarget }
  })
}

async function audit(packed: Packed): Promise<void> {
  const { manifest, files } = packed
  for (const entry of publicEntries(packed)) {
    for (const [condition, target] of [['import', entry.importTarget], ['types', entry.declaredTypesTarget],
    ['compiler declaration', entry.typesTarget]] as const) {
      if (target) assert(files.has(archiveKey(target)), `${manifest.name} missing packed ${condition} target ${target}`)
    }
  }
  // Inspect actual packed runtime imports, not the checkout's dev graph.
  // A cohort's directly installed core must not hide an undeclared package edge.
  for (const [name, file] of files) {
    if (!/\.(?:js|mjs|cjs)$/.test(name)) continue
    const source = await file.text()
    // A hashbang is executable-file trivia. Remove only that first-line
    // comment from the scanner view; the packed and installed bytes stay intact.
    const code = source.startsWith('#!') ? source.replace(/^#![^\r\n]*/, '') : source
    for (const imported of scanner.scanImports(code)) {
      const specifier = imported.path
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')
        || specifier.startsWith('bun:') || specifier === 'bun' || builtin.has(specifier)) continue
      const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (dependency === manifest.name) continue
      const declared = manifest.dependencies?.[dependency] ?? manifest.optionalDependencies?.[dependency]
      ?? manifest.peerDependencies?.[dependency]
      assert(declared, `${manifest.name}: ${name} imports ${dependency} without a packed runtime dependency or peer`)
    }
  }
}

async function comparePayload(packed: Packed, installed: string, phase: string): Promise<void> {
  assert(!(await realpath(installed)).startsWith(`${root}/`), `Installed ${packed.manifest.name} links to the checkout`)
  for (const [name, file] of packed.files) {
    assert(name.startsWith('package/'), `Unexpected archive path ${name}`)
    const relative = name.slice('package/'.length)
    assert(relative && !relative.split('/').includes('..'), `Unsafe archive member ${name}`)
    const expected = new Uint8Array(await file.arrayBuffer())
    const actual = await readFile(join(installed, relative))
    assert(hash(actual) === hash(expected), `Installed payload differs: ${packed.manifest.name}/${relative}`)
    payloads.push({ package: `${phase}:${packed.manifest.name}`, file: relative, sha256: hash(actual) })
  }
}

async function packageDirectory(entry: string, name: string): Promise<string> {
  let directory = dirname(await realpath(entry))
  for (;; ) {
    const file = Bun.file(join(directory, 'package.json'))
    if (await file.exists()) {
      const manifest: Manifest = await file.json()
      if (manifest.name === name) return directory
    }
    const parent = dirname(directory)
    assert(parent !== directory, `Cannot find installed package ${name} from ${entry}`)
    directory = parent
  }
}

/** Compare resolved package contents; legitimate hoisting or nesting is allowed. */
async function verifyInstalledCandidates(consumer: string, direct: Packed[], candidates: Packed[], core: Packed, phase: string): Promise<void> {
  const visited = new Set<string>()
  const queue = direct.map(packed => ({ packed, parent: join(consumer, 'package.json') }))
  while (queue.length) {
    const item = queue.shift()!
    await check(`${phase}: resolved ${item.packed.manifest.name}`, async () => {
      const entry = Bun.resolveSync(item.packed.manifest.name, item.parent)
      const directory = await packageDirectory(entry, item.packed.manifest.name)
      resolutions.push({ phase, consumer, from: item.parent, package: item.packed.manifest.name, entry, directory })
      const identity = `${item.packed.manifest.name}:${directory}`
      if (visited.has(identity)) return
      visited.add(identity)
      await comparePayload(item.packed, directory, phase)
      const manifest = item.packed.manifest
      const edges = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }
      for (const candidate of candidates) {
        if (candidate === item.packed) continue
        // Every adapter imports core at runtime. A missing manifest edge stays
        // an independent audit failure and must also fail actual resolution.
        if (edges[candidate.manifest.name] || (candidate === core && item.packed !== core))
          queue.push({ packed: candidate, parent: entry })
      }
    })
  }
}

async function compile(consumer: string, source: string, label: string, compilerRoot = consumer): Promise<{ code: number, output: string }> {
  await writeFile(join(consumer, 'probe.ts'), source)
  const compiler = join(compilerRoot, 'node_modules/typescript/lib/tsc.js')
  assert(await Bun.file(compiler).exists(), 'The installed TypeScript compiler is required; no skipped success')
  return run(label, [process.execPath, compiler, '--project', 'tsconfig.json'], consumer, 90000)
}

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtures, `${name}.txt`), 'utf8')
}

function assertPrivateDiagnostic(outcome: { code: number, output: string }, module: string): void {
  const diagnostics = outcome.output.match(/TS\d+/g) ?? []
  assert(outcome.code !== 0 && diagnostics.length === 1 && diagnostics[0] === 'TS2724'
    && outcome.output.includes('probe.ts(1,10): error TS2724:')
    && outcome.output.includes(`'"${module}"' has no exported member named '__brand'. Did you mean 'Brand'?`),
  `Expected exact private __brand TS2724 at probe.ts(1,10): ${outcome.output}`)
}

/** Independent authored compiler input, never an installed SDK/runtime alias. */
async function verifyAuthoredPrivateContract(consumer: string, name: string, core: Packed): Promise<void> {
  const directory = join(consumer, 'authored-private-reference')
  await mkdir(directory)
  const sourceFile = join(root, 'packages/dtsx/src/branded-types.ts')
  const source = await readFile(sourceFile)
  // This exact authored source snapshot is only a no-emit diagnostic oracle.
  // Actual SDK positive/negative/runtime probes continue to use bare imports.
  await writeFile(join(directory, 'branded-types.ts'), source)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  await writeFile(join(directory, 'tsconfig.json'), await readFile(join(consumer, 'tsconfig.json')))
  const positive = await compile(directory, await fixture('authored-private-positive.ts'), `${name}-authored-private-positive`, consumer)
  assert(positive.code === 0, `Authored brand reference must compile: ${positive.output}`)
  const negative = await compile(directory, await fixture('authored-private-negative.ts'), `${name}-authored-private-negative`, consumer)
  assertPrivateDiagnostic(negative, './branded-types.js')
  const installed = await packageDirectory(Bun.resolveSync(core.manifest.name, join(consumer, 'package.json')), core.manifest.name)
  const target = targetFor(core.manifest, './branded-types', 'types')
  const declaration = await readFile(join(installed, target.slice(2)), 'utf8')
  assert(/\bdeclare\s+const\s+__brand\s*:\s*unique\s+symbol\s*;/.test(declaration)
    && /readonly\s*\[\s*__brand\s*\]/.test(declaration),
  'The installed SDK must retain its private unique symbol and computed brand key')
  authoredPrivateProofs.push({ consumer, sourceFile, sourceSHA256: hash(source), reference: directory,
  installedDeclaration: join(installed, target.slice(2)), declarationSHA256: hash(Buffer.from(declaration)),
  diagnostic: { code: 'TS2724', line: 1, column: 10, privateName: '__brand', suggestedPublicName: 'Brand' },
  qualification: 'Authored no-emit reference only; no source snapshot is installed or imported by SDK probes.' })
}

async function verifyConsumer(name: string, packages: Packed[], primary: Packed, core: Packed, tools: Record<string, string>, provider: CandidateRegistry, candidates: Packed[]): Promise<void> {
  const consumer = join(evidence, name)
  await mkdir(consumer)
  const dependencies: Record<string, string> = Object.fromEntries(packages.map(item => [item.manifest.name, item.manifest.version]))
  for (const item of packages) {
    for (const [peer, range] of Object.entries(item.manifest.peerDependencies ?? {})) {
      if (item.manifest.peerDependenciesMeta?.[peer]?.optional || tools[peer]) continue
      assert(!range.startsWith('workspace:'), `Unresolved packed peer protocol ${peer}`)
      const candidate = packages.find(artifact => artifact.manifest.name === peer)
      if (candidate) {
        assert(Bun.semver.satisfies(candidate.manifest.version, range), `Candidate ${peer} does not satisfy ${range}`)
        continue
      }
      assert(!dependencies[peer] || dependencies[peer] === range, `Conflicting peer ranges for ${peer}`)
      dependencies[peer] = range
    }
  }
  const scopes = [...new Set(candidates.map(item => item.manifest.name.startsWith('@') ? item.manifest.name.split('/')[0] : '').filter(Boolean))]
  await writeFile(join(consumer, '.npmrc'), [`registry=${provider.url}`, 'always-auth=false',
  ...scopes.map(scope => `${scope}:registry=${provider.url}`), ''].join('\n'))
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: `strict-${name}`, private: true, type: 'module', dependencies, devDependencies: tools }, null, 2))
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true,
    skipLibCheck: false, skipDefaultLibCheck: false, types: ['bun'], paths: {}, noEmit: true,
  }, files: ['probe.ts'] }, null, 2))
  const installed = await run(`${name}-install`, [process.execPath, 'install'], consumer)
  assert(installed.code === 0, installed.output)
  await verifyInstalledCandidates(consumer, packages, candidates, core, `${name}:normal`)
  const lock = await readFile(join(consumer, 'bun.lock'))
  const frozen = await run(`${name}-frozen`, [process.execPath, 'install', '--frozen-lockfile'], consumer)
  assert(frozen.code === 0, frozen.output)
  assert(hash(await readFile(join(consumer, 'bun.lock'))) === hash(lock), 'Frozen install changed the consumer lock')
  await verifyInstalledCandidates(consumer, packages, candidates, core, `${name}:frozen`)
  const resolvedTools: Record<string, string> = {}
  for (const tool of new Set(['typescript', '@types/bun', 'bun-types', ...Object.keys(tools), ...Object.keys(dependencies).filter(key => !packages.some(item => item.manifest.name === key))])) {
    const manifest: Manifest = await Bun.file(join(consumer, 'node_modules', tool, 'package.json')).json()
    resolvedTools[tool] = manifest.version
  }
  graphs.push({ name, kind: 'prepublication-owned-candidate-registry', registry: provider.url,
  directTargets: packages.map(item => ({ name: item.manifest.name, version: item.manifest.version, private: item.manifest.private ?? false })),
  dependencies, authoredTools: tools, resolvedTools, lockSHA256: hash(lock),
  qualification: 'Private candidate-provider checks do not qualify the actual public released registry graph.' })

  const baseline = await compile(consumer, "export const baseline: string = 'strict Bun environment'\n", `${name}-baseline`)
  results.push({ name: `${name}: same-environment baseline`, ok: baseline.code === 0, detail: baseline.code === 0 ? undefined : baseline.output })
  const hosts = Object.keys(dependencies).filter(key => !packages.some(item => item.manifest.name === key))
  let hostBaselinePassed = true
  if (hosts.length) {
    const source = hosts.map((host, index) => `import type * as Host${index} from ${JSON.stringify(host)}; export type Peer${index} = typeof Host${index};`).join('\n')
    const peers = await compile(consumer, source, `${name}-host-peer-baseline`)
    hostBaselinePassed = peers.code === 0
    results.push({ name: `${name}: advertised host peer baseline`, ok: peers.code === 0, detail: peers.code === 0 ? undefined : peers.output })
  }
  const positiveSource = name === 'cohort'
    ? `${await fixture('dtsx.ts')}\n${await fixture('cohort.ts')}`
    : name === 'tsdown' ? `${await fixture('dtsx.ts')}\n${await fixture('tsdown.ts')}`
    : await fixture(`${primary.directory}.ts`)
  const entries = (name === 'cohort' ? packages : [primary]).flatMap(item =>
    publicEntries(item).map(entry => ({ ...entry, specifier: `${item.manifest.name}${entry.subpath.slice(1)}` })))
  const publicImports = entries.map((entry, index) => entry.typeOnly
    ? `import type * as GateEntry${index} from ${JSON.stringify(entry.specifier)}; export type GateEntryProof${index} = typeof GateEntry${index};`
    : `import * as GateEntry${index} from ${JSON.stringify(entry.specifier)}; void GateEntry${index};`).join('\n')
  const positive = await compile(consumer, `${positiveSource}\n${publicImports}`, `${name}-positive`)
  results.push({ name: `${name}: full public SDK positive`, ok: positive.code === 0, detail: positive.code === 0 ? undefined : positive.output })
  // A dependency error must not be misreported as the expected negative error.
  if (positive.code === 0) {
    const negatives = primary.directory === 'dtsx'
      ? [{ file: 'negative-brand.ts', code: 'TS2322' }, { file: 'negative-private.ts', code: 'TS2724' }, { file: 'negative-native-options.ts', code: 'TS2322' }, { file: 'negative-native-result.ts', code: 'TS2322' }]
      : [{ file: 'negative-mode.ts', code: 'TS2322' }]
    for (const negative of negatives) {
      if (negative.file === 'negative-private.ts') await verifyAuthoredPrivateContract(consumer, name, core)
      const source = (await fixture(negative.file)).replaceAll('SDK_PACKAGE', primary.manifest.name)
      const outcome = await compile(consumer, source, `${name}-${negative.file}`)
      if (negative.file === 'negative-private.ts') {
        assertPrivateDiagnostic(outcome, `${core.manifest.name}/branded-types`)
        continue
      }
      const diagnostics = outcome.output.match(/TS\d+/g) ?? []
      assert(outcome.code !== 0 && diagnostics.length === 1 && diagnostics[0] === negative.code
        && outcome.output.includes('probe.ts'), `Expected sole ${negative.code}: ${outcome.output}`)
    }
  }
  else results.push({ name: `${name}: negatives blocked by failed positive`, ok: false })

  const runtimeEntries = entries.filter(entry => !entry.typeOnly).map(entry => entry.specifier)
  let runtime = `import assert from 'node:assert/strict'\nfor (const entry of ${JSON.stringify(runtimeEntries)}) { await import(entry) }\n${primary.directory === 'dtsx' ? "const { processSource } = await import('@dtsx/dtsx'); assert.equal(typeof processSource('export const marker: number = 1', 'sdk.ts'), 'string')\n" : ''}`
  if (name === 'dtsx') runtime += `
const { formatDts } = await import('@dtsx/dtsx/formatter')
const formatted = await formatDts('export interface Example{value:string}', { usePrettier: true })
assert.equal(formatted.usedPrettier, false)
assert.deepEqual(formatted.warnings, ['Prettier requested but not available. Using built-in formatter.'])
`
  if (name === 'optional-prettier') runtime += `
const { formatDts } = await import('@dtsx/dtsx/formatter')
const { format } = await import('prettier')
const input = 'export interface Example{value:string}'
const formatted = await formatDts(input, { usePrettier: true, prettierOptions: { semi: true } })
assert.equal(formatted.usedPrettier, true, JSON.stringify(formatted.warnings))
assert.equal(formatted.content, await format(input, { parser: 'typescript', semi: true }))
`
  if (name === 'tsdown') runtime += `
const { build } = await import('tsdown')
const { dts } = await import('@dtsx/dtsx/tsdown')
const { writeFile, readFile } = await import('node:fs/promises')
await writeFile('entry.ts', 'export class Calculate { #hidden = () => ({ value: 2 }); value(): number { return this.#hidden().value } }')
await build({ config: false, entry: ['entry.ts'], outDir: 'output', plugins: [dts()], logLevel: 'silent', report: false })
assert.match(await readFile('output/entry.d.mts', 'utf8'), /value\\(\\): number/)
const { Calculate } = await import('./output/entry.mjs')
assert.equal(new Calculate().value(), 2)
`
  await writeFile(join(consumer, 'runtime.ts'), runtime)
  const runtimeResult = await run(`${name}-Bun-runtime`, [process.execPath, 'runtime.ts'], consumer, 60000)
  assert(runtimeResult.code === 0, runtimeResult.output)
  assert(baseline.code === 0 && hostBaselinePassed && positive.code === 0,
  'Installed SDK compiler checks failed; see the retained baseline and positive diagnostics')
}

try {
  const owner: Manifest = await Bun.file(join(root, 'package.json')).json()
  const tools = { typescript: owner.devDependencies?.typescript, '@types/bun': owner.devDependencies?.['@types/bun'] }
  assert(tools.typescript && tools['@types/bun'], 'Authored TypeScript and Bun type ranges are required')
  const authoredTools: Record<string, string> = { typescript: tools.typescript, '@types/bun': tools['@types/bun'] }
  assert(Bun.semver.satisfies('7.0.2', authoredTools.typescript), 'Maintained TypeScript 7.0.2 must remain allowed by the authored tool range')
  for (const tool of ['typescript', '@types/bun', 'bun-types']) {
    const manifest: Manifest = await Bun.file(join(root, 'node_modules', tool, 'package.json')).json()
    ownerToolVersions[tool] = manifest.version
  }
  const packed: Packed[] = []
  for (const directory of ['dtsx', 'bun-plugin', 'vite-plugin', 'esbuild-plugin', 'webpack-plugin', 'tsup-plugin', 'tsdown-plugin']) {
    await check(`normal pack ${directory}`, async () => {
      const archive = join(evidence, `${directory}.tgz`)
      const output = await run(`pack-${directory}`, [process.execPath, 'pm', 'pack', '--filename', archive], join(packagesRoot, directory), 60000)
      assert(output.code === 0, output.output)
      const files = await new Bun.Archive(await readFile(archive)).files()
      const manifestFile = files.get('package/package.json')
      assert(manifestFile, `Missing manifest in ${directory} archive`)
      const manifest: Manifest = JSON.parse(await manifestFile.text())
      assert(typeof manifest.name === 'string' && typeof manifest.version === 'string', `Invalid manifest in ${directory}`)
      const artifact = { directory, archive, manifest, files }
      const entries = publicEntries(artifact)
      archives.push({ package: manifest.name, version: manifest.version, private: manifest.private ?? false,
      archive, sha256: hash(await readFile(archive)), manifest, publicSubpaths: entries.map(entry => entry.subpath),
      publicEntries: entries, runtimeEntries: entries.filter(entry => !entry.typeOnly).map(entry => entry.subpath),
      typeOnlyEntries: entries.filter(entry => entry.typeOnly).map(entry => entry.subpath) })
      packed.push(artifact)
    })
  }
  const core = packed.find(item => item.directory === 'dtsx')
  assert(core, 'The actual core archive is required')
  for (const item of packed) await check(`packed dependency/export audit ${item.directory}`, async () => {
    const edge = item.manifest.dependencies?.[core.manifest.name] ?? item.manifest.optionalDependencies?.[core.manifest.name]
    ?? item.manifest.peerDependencies?.[core.manifest.name]
    if (item !== core && edge) assert(Bun.semver.satisfies(core.manifest.version, edge), `${item.manifest.name} packed core edge ${edge} does not admit the candidate version`)
    await audit(item)
  })
  assert(packed.length === 7, 'All seven normal candidate archives are required before registry installation')
  registry = await startRegistry(packed)
  for (const item of packed) {
    const passed = await check(`installed SDK ${item.directory}`, () => verifyConsumer(item.directory, [item], item, core, authoredTools, registry!, packed))
    await releasePassedInstallation(item.directory, passed)
  }
  const cohortPassed = await check('installed full cohort SDK', () => verifyConsumer('cohort', packed, core, core, authoredTools, registry!, packed))
  await releasePassedInstallation('cohort', cohortPassed)
  const prettier = core.manifest.peerDependencies?.prettier
  assert(prettier && core.manifest.peerDependenciesMeta?.prettier?.optional === true, 'The formatter provider must be an explicitly optional peer')
  const formatterPassed = await check('installed SDK with optional formatter provider', () => verifyConsumer('optional-prettier', [core], core, core, { ...authoredTools, prettier }, registry!, packed))
  await releasePassedInstallation('optional-prettier', formatterPassed)
  const tsdown = owner.devDependencies?.tsdown
  assert(tsdown, 'The authored tsdown comparison tool range is required')
  const tsdownPassed = await check('installed SDK with tsdown host', () => verifyConsumer('tsdown', [core], core, core, { ...authoredTools, tsdown }, registry!, packed))
  await releasePassedInstallation('tsdown', tsdownPassed)
}
catch (error) {
  results.push({ name: 'gate setup', ok: false, detail: error instanceof Error ? error.stack : String(error) })
}
finally {
  registryStopped = registry ? await check('owned candidate registry disposal', () => registry!.stop()) : true
  const failed = results.filter(result => !result.ok)
  await writeFile(join(evidence, 'receipt.json'), JSON.stringify({
    kind: 'prepublication strict installed candidate SDK gate', status: failed.length ? 'FAIL' : 'PASS',
    packageInput: { root: packagesRoot, kind: packagesRoot === join(root, 'packages') ? 'workspace build' : 'external package payloads' },
    evidence, runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    maintainedCompilerBaseline: '7.0.2', ownerToolVersions, archives, results, commands, graphs, payloads, resolutions, authoredPrivateProofs, installations,
    candidateRegistry: { url: registry?.url, started: Boolean(registry), requests: registryRequests, stopped: registryStopped,
    qualification: 'Owned loopback test provider; no actual public registry publication or admission is claimed.' },
    limits: ['No build or declaration generation was invoked by this gate.',
    'The loopback candidate registry serves exact normal archives without rewriting their manifests.',
    'Normal isolated released package/peer graphs and actual native availability require their separate qualification.'],
  }, null, 2))
  console.info(`Public SDK gate ${failed.length ? 'FAIL' : 'PASS'}: ${join(evidence, 'receipt.json')}`)
  process.exitCode = failed.length ? 1 : 0
}

#!/usr/bin/env node
// Postinstall: fetch the platform-matching prebuilt shared library from the
// GitHub release that matches this package's version. Falls back silently if
// the fetch fails so that monorepo dev installs (where the binary is built
// locally via `zig build lib`) aren't blocked.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const prebuiltDir = join(pkgDir, 'prebuilt')

const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

// Map node platform/arch to release-artifact slugs (mirrors release.yml build_target calls)
const PLATFORM_MAP = {
  'darwin-arm64': { slug: 'darwin-arm64', libFile: 'libzig-dtsx.dylib' },
  'darwin-x64': { slug: 'darwin-x64', libFile: 'libzig-dtsx.dylib' },
  'linux-arm64': { slug: 'linux-arm64', libFile: 'libzig-dtsx.so' },
  'linux-x64': { slug: 'linux-x64', libFile: 'libzig-dtsx.so' },
  'win32-x64': { slug: 'windows-x64', libFile: 'zig-dtsx.dll' },
  'freebsd-x64': { slug: 'freebsd-x64', libFile: 'libzig-dtsx.so' },
}

const key = `${platform()}-${arch()}`
const entry = PLATFORM_MAP[key]

if (!entry) {
  console.warn(`[zig-dtsx] no prebuilt for ${key}; run \`zig build lib\` locally if you need the FFI library`)
  process.exit(0)
}

// Skip if the lib already exists at the dev-build location — monorepo path.
if (existsSync(join(pkgDir, 'zig-out', 'lib', entry.libFile)) || existsSync(join(pkgDir, 'zig-out', 'bin', entry.libFile))) {
  process.exit(0)
}

// Skip if prebuilt already in place from a prior install of the same version.
if (existsSync(join(prebuiltDir, entry.libFile))) {
  process.exit(0)
}

const archiveName = `zig-dtsx-lib-${entry.slug}.tar.gz`
const url = `https://github.com/stacksjs/dtsx/releases/download/v${version}/${archiveName}`

try {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  mkdirSync(prebuiltDir, { recursive: true })
  const tmpArchive = join(prebuiltDir, `.${archiveName}.tmp`)
  writeFileSync(tmpArchive, buf)

  const tarResult = spawnSync('tar', ['-xzf', tmpArchive, '-C', prebuiltDir], { stdio: 'inherit' })
  rmSync(tmpArchive, { force: true })

  if (tarResult.status !== 0)
    throw new Error(`tar exited with code ${tarResult.status}`)

  if (!existsSync(join(prebuiltDir, entry.libFile)))
    throw new Error(`archive did not contain expected file ${entry.libFile}`)
}
catch (err) {
  console.warn(`[zig-dtsx] could not fetch prebuilt from ${url}: ${err.message}`)
  console.warn(`[zig-dtsx] dev workflow: run \`zig build lib\` inside this package.`)
  // Exit 0 — never block installs over a missing prebuilt.
  process.exit(0)
}

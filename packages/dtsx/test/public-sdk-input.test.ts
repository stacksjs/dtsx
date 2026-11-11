import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const cases = [
  { name: 'missing released inputs', mode: 'public', reason: 'Public registry checks require explicit released package payloads' },
  { name: 'unknown mode', mode: 'invalid-mode', reason: 'DTSX_SDK_REGISTRY_MODE must be candidate or public' },
  ...['BUN_CONFIG_REGISTRY', 'NPM_CONFIG_REGISTRY', 'npm_config_registry'].map(key => ({ name: key, mode: 'public', key, reason: `Public registry mode rejects registry override ${key}` })),
]

for (const fixture of cases) {
  test(`the public SDK gate rejects ${fixture.name} before invoking package commands`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-sdk-input-'))
    try {
      const root = resolve(import.meta.dir, '../../..')
      const env: Record<string, string | undefined> = { ...process.env }
      for (const key of Object.keys(env)) if (/^(bun_config_registry|npm_config_registry)$/i.test(key)) delete env[key]
      Object.assign(env, {
        DTSX_SDK_REGISTRY_MODE: fixture.mode,
        DTSX_SDK_PACKAGES_ROOT: fixture.name === 'missing released inputs' ? undefined : directory,
        DTSX_SDK_EVIDENCE: directory,
      })
      if ('key' in fixture) env[fixture.key] = 'http://127.0.0.1:1/'
      const child = Bun.spawn([process.execPath, '--no-env-file', join(root, 'scripts/verify-public-sdk.ts')], { cwd: root, env, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      const output = stdout + stderr
      expect(code, output).not.toBe(0)
      const receiptPath = /Public SDK gate FAIL: (.+receipt\.json)/.exec(output)?.[1]
      expect(receiptPath, output).toBeDefined()
      const receipt = JSON.parse(await readFile(receiptPath!, 'utf8'))
      expect(receipt.status).toBe('FAIL')
      expect(receipt.results).toHaveLength(1)
      expect(receipt.results[0].detail).toContain(fixture.reason)
      expect(receipt.commands).toEqual([])
      expect(receipt.archives).toEqual([])
      expect(receipt.graphs).toEqual([])
      expect(receipt.candidateRegistry.started).toBe(false)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  }, 15_000)
}

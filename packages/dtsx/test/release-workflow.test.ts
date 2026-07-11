import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, string | number | boolean>
}

interface ReleaseWorkflow {
  jobs: {
    release: {
      permissions: Record<string, string>
      steps: WorkflowStep[]
    }
  }
}

const workflowPath = resolve(import.meta.dir, '../../../.github/workflows/release.yml')

async function loadReleaseWorkflow(): Promise<ReleaseWorkflow> {
  return Bun.YAML.parse(await Bun.file(workflowPath).text()) as ReleaseWorkflow
}

describe('release workflow', () => {
  it('uses Pantry to create the GitHub release', async () => {
    const workflow = await loadReleaseWorkflow()
    const steps = workflow.jobs.release.steps
    const releaseStep = steps.find(step => step.name === 'Create GitHub Release with Pantry')

    expect(workflow.jobs.release.permissions.contents).toBe('write')
    expect(releaseStep?.uses).toMatch(/^home-lang\/pantry\/packages\/action@[a-f0-9]{40}$/)
    expect(String(releaseStep?.with?.release)).toBe('true')
    expect(releaseStep?.with?.['release-tag']).toBe('${{ env.RELEASE_TAG }}')
    expect(steps.some(step => step.uses?.includes('action-releaser'))).toBe(false)
  })

  it('uses Logsmith-generated notes and Pantry SHA-256 checksums', async () => {
    const workflow = await loadReleaseWorkflow()
    const releaseStep = workflow.jobs.release.steps.find(step => step.name === 'Create GitHub Release with Pantry')
    const releaseFiles = String(releaseStep?.with?.['release-files'] ?? '')
      .split('\n')
      .map(file => file.trim())
      .filter(Boolean)

    expect(releaseStep?.with?.['release-changelog']).toBe('auto')
    expect(releaseStep?.with?.['release-checksums']).toBe('sha256')
    expect(releaseFiles).toHaveLength(12)
    expect(new Set(releaseFiles).size).toBe(releaseFiles.length)
    expect(releaseFiles.every(file => file.startsWith('packages/dtsx/bin/zig-dtsx-'))).toBe(true)
  })

  it('verifies local hashes, published assets, and release notes', async () => {
    const workflow = await loadReleaseWorkflow()
    const verifyStep = workflow.jobs.release.steps.find(step => step.name === 'Verify Pantry GitHub Release')
    const verification = verifyStep?.run ?? ''

    expect(verification).toContain('sha256sum --check')
    expect(verification).toContain("grep -Fx 'checksums.txt'")
    expect(verification).toContain('gh release view')
    expect(verification).toContain('test -n "${release_body}"')
  })
})

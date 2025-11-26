import type { DtsGenerationConfig, GenerationStats } from './types'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { generate } from './generator'
import { logger, setLogLevel } from './logger'

/**
 * Workspace project configuration
 */
export interface WorkspaceProject {
  /** Project name */
  name: string
  /** Project root directory (absolute path) */
  root: string
  /** Path to tsconfig.json (absolute path) */
  tsconfigPath: string
  /** Project references (project names this project depends on) */
  references: string[]
  /** Custom config overrides for this project */
  config?: Partial<DtsGenerationConfig>
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace root directory */
  root: string
  /** Projects in the workspace */
  projects: WorkspaceProject[]
  /** Shared configuration applied to all projects */
  sharedConfig?: Partial<DtsGenerationConfig>
}

/**
 * Result of workspace generation
 */
export interface WorkspaceGenerationResult {
  /** Overall success status */
  success: boolean
  /** Per-project results */
  projects: Array<{
    name: string
    stats: GenerationStats
    success: boolean
    error?: string
  }>
  /** Total duration in milliseconds */
  durationMs: number
}

/**
 * TypeScript project reference
 */
interface TsConfigReference {
  path: string
}

/**
 * Discover workspace projects from TypeScript project references
 */
export async function discoverWorkspaceProjects(rootTsConfig: string): Promise<WorkspaceProject[]> {
  const projects: WorkspaceProject[] = []
  const visited = new Set<string>()

  async function processProject(tsconfigPath: string, parentName?: string): Promise<void> {
    const absolutePath = resolve(tsconfigPath)

    if (visited.has(absolutePath)) {
      return
    }
    visited.add(absolutePath)

    if (!existsSync(absolutePath)) {
      logger.warn(`tsconfig not found: ${absolutePath}`)
      return
    }

    try {
      const content = readFileSync(absolutePath, 'utf-8')
      // Remove comments for JSON parsing
      const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const tsconfig = JSON.parse(jsonContent)

      const projectRoot = dirname(absolutePath)
      const projectName = getProjectName(projectRoot, parentName)

      // Get references
      const references: string[] = []
      if (tsconfig.references) {
        for (const ref of tsconfig.references as TsConfigReference[]) {
          const refPath = resolve(projectRoot, ref.path)
          const refTsConfig = existsSync(join(refPath, 'tsconfig.json'))
            ? join(refPath, 'tsconfig.json')
            : refPath

          // Process referenced project
          await processProject(refTsConfig, projectName)

          // Add to references
          const refName = getProjectName(dirname(refTsConfig), projectName)
          references.push(refName)
        }
      }

      // Determine source root from tsconfig
      let srcRoot = './src'
      if (tsconfig.compilerOptions?.rootDir) {
        srcRoot = tsconfig.compilerOptions.rootDir
      }
      else if (tsconfig.include && tsconfig.include.length > 0) {
        // Try to extract root from include patterns
        const firstInclude = tsconfig.include[0]
        if (firstInclude.startsWith('src/')) {
          srcRoot = './src'
        }
      }

      // Determine output directory
      let outDir = './dist'
      if (tsconfig.compilerOptions?.outDir) {
        outDir = tsconfig.compilerOptions.outDir
      }
      else if (tsconfig.compilerOptions?.declarationDir) {
        outDir = tsconfig.compilerOptions.declarationDir
      }

      projects.push({
        name: projectName,
        root: projectRoot,
        tsconfigPath: absolutePath,
        references,
        config: {
          root: srcRoot,
          outdir: outDir,
        },
      })
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to parse ${absolutePath}: ${errorMessage}`)
    }
  }

  await processProject(rootTsConfig)

  return projects
}

/**
 * Get a project name from its path
 */
function getProjectName(projectRoot: string, parentName?: string): string {
  // Try to read package.json for the name
  const packageJsonPath = join(projectRoot, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const content = readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      if (pkg.name) {
        return pkg.name
      }
    }
    catch {
      // Ignore
    }
  }

  // Use directory name
  const dirName = projectRoot.split('/').pop() || 'unknown'
  return parentName ? `${parentName}/${dirName}` : dirName
}

/**
 * Sort projects by their dependencies (topological sort)
 * Projects with no dependencies come first
 */
export function sortProjectsByDependencies(projects: WorkspaceProject[]): WorkspaceProject[] {
  const projectMap = new Map(projects.map(p => [p.name, p]))
  const sorted: WorkspaceProject[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      logger.warn(`Circular dependency detected involving: ${name}`)
      return
    }

    visiting.add(name)

    const project = projectMap.get(name)
    if (project) {
      for (const ref of project.references) {
        visit(ref)
      }
      sorted.push(project)
    }

    visiting.delete(name)
    visited.add(name)
  }

  for (const project of projects) {
    visit(project.name)
  }

  return sorted
}

/**
 * Generate declarations for all projects in a workspace
 */
export async function generateWorkspace(config: WorkspaceConfig): Promise<WorkspaceGenerationResult> {
  const startTime = Date.now()

  // Sort projects by dependencies
  const sortedProjects = sortProjectsByDependencies(config.projects)

  logger.info(`Generating declarations for ${sortedProjects.length} projects...`)

  const results: WorkspaceGenerationResult['projects'] = []
  let overallSuccess = true

  for (const project of sortedProjects) {
    logger.info(`\n[${project.name}] Generating...`)

    try {
      // Merge configs: shared < project-specific
      const projectConfig: Partial<DtsGenerationConfig> = {
        ...config.sharedConfig,
        ...project.config,
        cwd: project.root,
        tsconfigPath: project.tsconfigPath,
      }

      const stats = await generate(projectConfig)

      const success = stats.filesFailed === 0
      if (!success) {
        overallSuccess = false
      }

      results.push({
        name: project.name,
        stats,
        success,
      })

      logger.info(`[${project.name}] Generated ${stats.filesGenerated} files`)
    }
    catch (error) {
      overallSuccess = false
      const errorMessage = error instanceof Error ? error.message : String(error)

      results.push({
        name: project.name,
        stats: {
          filesProcessed: 0,
          filesGenerated: 0,
          filesFailed: 0,
          filesValidated: 0,
          validationErrors: 0,
          declarationsFound: 0,
          importsProcessed: 0,
          exportsProcessed: 0,
          durationMs: 0,
          errors: [],
        },
        success: false,
        error: errorMessage,
      })

      logger.error(`[${project.name}] Failed: ${errorMessage}`)
    }
  }

  const durationMs = Date.now() - startTime

  // Summary
  const successCount = results.filter(r => r.success).length
  const failedCount = results.length - successCount

  logger.info('\n--- Workspace Generation Summary ---')
  logger.info(`Projects processed: ${results.length}`)
  logger.info(`Successful:         ${successCount}`)
  if (failedCount > 0) {
    logger.info(`Failed:             ${failedCount}`)
  }
  logger.info(`Total duration:     ${durationMs}ms`)
  logger.info('------------------------------------\n')

  return {
    success: overallSuccess,
    projects: results,
    durationMs,
  }
}

/**
 * Discover and generate declarations for a monorepo
 * Automatically discovers projects from TypeScript project references
 */
export async function generateMonorepo(
  rootPath: string,
  options?: Partial<DtsGenerationConfig>,
): Promise<WorkspaceGenerationResult> {
  // Configure logger
  if (options?.logLevel) {
    setLogLevel(options.logLevel)
  }

  // Find root tsconfig
  const rootTsConfig = join(rootPath, 'tsconfig.json')
  if (!existsSync(rootTsConfig)) {
    throw new Error(`Root tsconfig.json not found at: ${rootTsConfig}`)
  }

  logger.info('Discovering workspace projects...')

  // Discover projects
  const projects = await discoverWorkspaceProjects(rootTsConfig)

  if (projects.length === 0) {
    logger.warn('No projects found in workspace')
    return {
      success: true,
      projects: [],
      durationMs: 0,
    }
  }

  logger.info(`Found ${projects.length} projects`)

  // Generate for all projects
  return generateWorkspace({
    root: rootPath,
    projects,
    sharedConfig: options,
  })
}

/**
 * Parse workspace patterns from package.json workspaces field
 */
export async function discoverWorkspaceFromPackageJson(rootPath: string): Promise<string[]> {
  const packageJsonPath = join(rootPath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return []
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8')
    const pkg = JSON.parse(content)

    // Handle both array format and object format
    let patterns: string[] = []
    if (Array.isArray(pkg.workspaces)) {
      patterns = pkg.workspaces
    }
    else if (pkg.workspaces?.packages) {
      patterns = pkg.workspaces.packages
    }

    return patterns
  }
  catch {
    return []
  }
}

/**
 * Resolve workspace patterns to actual project paths
 */
export async function resolveWorkspacePatterns(
  rootPath: string,
  patterns: string[],
): Promise<string[]> {
  const { Glob } = await import('bun')
  const projectPaths: string[] = []

  for (const pattern of patterns) {
    const glob = new Glob(pattern)

    for await (const path of glob.scan({
      cwd: rootPath,
      absolute: true,
      onlyFiles: false,
    })) {
      // Check if it's a directory with package.json
      const packageJsonPath = join(path, 'package.json')
      if (existsSync(packageJsonPath)) {
        projectPaths.push(path)
      }
    }
  }

  return projectPaths
}

/**
 * Generate declarations for a workspace defined in package.json
 */
export async function generateFromPackageWorkspaces(
  rootPath: string,
  options?: Partial<DtsGenerationConfig>,
): Promise<WorkspaceGenerationResult> {
  // Configure logger
  if (options?.logLevel) {
    setLogLevel(options.logLevel)
  }

  // Discover workspace patterns
  const patterns = await discoverWorkspaceFromPackageJson(rootPath)

  if (patterns.length === 0) {
    logger.warn('No workspace patterns found in package.json')
    return {
      success: true,
      projects: [],
      durationMs: 0,
    }
  }

  logger.info(`Found workspace patterns: ${patterns.join(', ')}`)

  // Resolve patterns to actual paths
  const projectPaths = await resolveWorkspacePatterns(rootPath, patterns)

  if (projectPaths.length === 0) {
    logger.warn('No projects found matching workspace patterns')
    return {
      success: true,
      projects: [],
      durationMs: 0,
    }
  }

  logger.info(`Found ${projectPaths.length} workspace packages`)

  // Convert to workspace projects
  const projects: WorkspaceProject[] = projectPaths.map((projectPath) => {
    const tsconfigPath = join(projectPath, 'tsconfig.json')
    return {
      name: getProjectName(projectPath),
      root: projectPath,
      tsconfigPath: existsSync(tsconfigPath) ? tsconfigPath : '',
      references: [], // We'd need to parse tsconfig to get references
    }
  })

  // Generate for all projects
  return generateWorkspace({
    root: rootPath,
    projects,
    sharedConfig: options,
  })
}

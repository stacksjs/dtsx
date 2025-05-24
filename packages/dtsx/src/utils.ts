import type { DtsGenerationConfig } from './types'
import { readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { config } from './config'

export async function writeToFile(filePath: string, content: string): Promise<void> {
  await Bun.write(filePath, content)
}

export async function getAllTypeScriptFiles(directory?: string): Promise<string[]> {
  const dir = directory ?? config.root
  const entries = await readdir(dir, { withFileTypes: true })

  const files = await Promise.all(entries.map((entry) => {
    const res = join(dir, entry.name)
    return entry.isDirectory() ? getAllTypeScriptFiles(res) : res
  }))

  return Array.prototype.concat(...files).filter(file => extname(file) === '.ts')
}

// only checks for 2 potentially nested levels
export async function checkIsolatedDeclarations(options?: DtsGenerationConfig): Promise<boolean> {
  try {
    const cwd = options?.cwd || process.cwd()
    const tsconfigPath = options?.tsconfigPath || join(cwd, 'tsconfig.json')

    // Convert to file URL for import()
    const baseConfigPath = pathToFileURL(tsconfigPath).href
    const baseConfig = await import(baseConfigPath)

    if (baseConfig.compilerOptions?.isolatedDeclarations === true) {
      return true
    }

    // If there's an extends property, we need to check the extended config
    if (baseConfig.extends) {
      // Make the extended path absolute relative to the base config
      const extendedPath = makeAbsolute(tsconfigPath, baseConfig.extends)
      // Add .json if not present
      const fullExtendedPath = extendedPath.endsWith('.json') ? extendedPath : `${extendedPath}.json`
      const extendedConfigPath = pathToFileURL(fullExtendedPath).href
      const extendedConfig = await import(extendedConfigPath)

      // Recursively check extended configs
      if (extendedConfig.compilerOptions?.isolatedDeclarations === true) {
        return true
      }

      // If the extended config also extends another config, check that too
      if (extendedConfig.extends) {
        // Make the next extended path absolute relative to the previous extended config
        const nextExtendedPath = makeAbsolute(fullExtendedPath, extendedConfig.extends)
        const fullNextExtendedPath = nextExtendedPath.endsWith('.json') ? nextExtendedPath : `${nextExtendedPath}.json`
        const extendedExtendedConfigPath = pathToFileURL(fullNextExtendedPath).href
        const extendedExtendedConfig = await import(extendedExtendedConfigPath)

        if (extendedExtendedConfig.compilerOptions?.isolatedDeclarations === true) {
          return true
        }
      }
    }

    return false
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (error) {
    return false
  }
}

function makeAbsolute(basePath: string, configPath: string): string {
  // If it's already absolute, return as is
  if (isAbsolute(configPath)) {
    return configPath
  }

  // If it starts with a dot, resolve relative to base path
  if (configPath.startsWith('.')) {
    return resolve(dirname(basePath), configPath)
  }

  // For node_modules paths, resolve from cwd
  return resolve(process.cwd(), 'node_modules', configPath)
}

import os from 'node:os'
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  type ParsedPath,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from 'node:path'
import process from 'node:process'
import { someUnusedImport, something as dts } from './generate';
import { generate } from '@stacksjs/dtsx'
import forge, { pki, tls } from 'node-forge'
import { runCommandSync } from '@stacksjs/cli'
import { log } from '@stacksjs/logging'

/**
 * Returns the path to the `actions` directory. The `actions` directory
 * contains the core Stacks' actions.
 *
 * @param path - The relative path to the file or directory.
 * @returns The absolute path to the file or directory.
 * @example
 * ```ts
 * import { actionsPath } from '@stacksjs/path'
 *
 * console.log(actionsPath('path/to/action.ts')) // Outputs the absolute path to 'path/to/action.ts' within the `actions` directory
 * ```
 */
export function actionsPath(path?: string): string {
  return corePath(`actions/${path || ''}`)
}


export function corePath(path?: string): string {
  return frameworkPath(`core/${path || ''}`)
}

export function frameworkPath(path?: string, options?: { relative?: boolean, cwd?: string }): string {
  const absolutePath = storagePath(`framework/${path || ''}`)

  if (options?.relative)
    return relative(options.cwd || process.cwd(), absolutePath)

  return absolutePath
}

export function storagePath(path?: string): string {
  return projectPath(`storage/${path || ''}`)
}

export function projectPath(filePath = '', options?: { relative: boolean }): string {
  let path = process.cwd()

  while (path.includes('storage')) path = resolve(path, '..')

  const finalPath = resolve(path, filePath)

  if (options?.relative)
    return relative(process.cwd(), finalPath)

  return finalPath
}

export function userActionsPath(path?: string, options?: { relative: true }): string {
  const absolutePath = appPath(`Actions/${path || ''}`)

  if (options?.relative)
    return relative(process.cwd(), absolutePath)

  return absolutePath
}

export function builtUserActionsPath(path?: string, options?: { relative: boolean }): string {
  const absolutePath = frameworkPath(`actions/${path || ''}`)

  if (options?.relative)
    return relative(process.cwd(), absolutePath)

  return absolutePath
}

/**
 * Returns the path to the home directory, optionally appending a given path.
 *
 * @param path - The relative path to append to the home directory path.
 * @returns The absolute path to the specified file or directory within the home directory.
 */
export function homeDir(path?: string): string {
  return os.homedir() + (path ? (path.startsWith('/') ? '' : '/') + path : '~')
}

/**
 * Returns the path to the library entry file, filtered by library type.
 *
 * @param type - The type of library ('vue-components', 'web-components', or 'functions').
 * @returns The absolute path to the specified library entry file.
 */
export type LibraryType = 'vue-components' | 'web-components' | 'functions'
export function libraryEntryPath(type: LibraryType): string {
  return libsEntriesPath(`${type}.ts`)
}

/**
 * Returns the path to the `examples` directory within the framework directory, filtered by type.
 *
 * @param type - The type of examples to filter by ('vue-components' or 'web-components').
 * @returns The absolute path to the specified type of examples within the `examples` directory.
 */
export function examplesPath(type?: 'vue-components' | 'web-components'): string {
  return frameworkPath(`examples/${type || ''}`)
}

export interface Path {
  actionsPath: (path?: string) => string
  userActionsPath: (path?: string) => string
  builtUserActionsPath: (path?: string, option?: { relative: boolean }) => string
  examplesPath: (type?: 'vue-components' | 'web-components') => string
  libraryEntryPath: (type: LibraryType) => string
  homeDir: (path?: string) => string
  parse: (path: string) => ParsedPath
  sep: () => '/' | '\\'
}

export const path: Path = {
  actionsPath,
  userActionsPath,
  builtUserActionsPath,
  homeDir,

  // some comment
  libraryEntryPath,
  examplesPath,
  parse,
  sep: () => sep,
}

export { basename, forge, generate, pki, tls, delimiter, dirname, dts, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath }
export default forge

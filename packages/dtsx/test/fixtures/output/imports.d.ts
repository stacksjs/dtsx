import { basename, delimiter, dirname, extname, isAbsolute, join, normalize, type ParsedPath, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { generate } from '@stacksjs/dtsx';
import { something as dts } from './generate';
import forge, { pki, tls } from 'node-forge';
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
export declare function actionsPath(path?: string): string;
export declare function corePath(path?: string): string;
export declare function frameworkPath(path?: string, options?: { relative?: boolean, cwd?: string }): string;
export declare function storagePath(path?: string): string;
export declare function projectPath(filePath?: any, options?: { relative: boolean }): string;
export declare function userActionsPath(path?: string, options?: { relative: true }): string;
export declare function builtUserActionsPath(path?: string, options?: { relative: boolean }): string;
/**
 * Returns the path to the home directory, optionally appending a given path.
 *
 * @param path - The relative path to append to the home directory path.
 * @returns The absolute path to the specified file or directory within the home directory.
 */
export declare function homeDir(path?: string): string;
export declare function libraryEntryPath(type: LibraryType): string;
/**
 * Returns the path to the `examples` directory within the framework directory, filtered by type.
 *
 * @param type - The type of examples to filter by ('vue-components' or 'web-components').
 * @returns The absolute path to the specified type of examples within the `examples` directory.
 */
export declare function examplesPath(type?: 'vue-components' | 'web-components'): string;
export declare const path: Path;
export declare interface Path {
  actionsPath: (path?: string) => string
  userActionsPath: (path?: string) => string
  builtUserActionsPath: (path?: string, option?: { relative: boolean }) => string
  examplesPath: (type?: 'vue-components' | 'web-components') => string
  libraryEntryPath: (type: LibraryType) => string
  homeDir: (path?: string) => string
  parse: (path: string) => ParsedPath
  sep: () => '/' | '\\'
}
/**
 * Returns the path to the library entry file, filtered by library type.
 *
 * @param type - The type of library ('vue-components', 'web-components', or 'functions').
 * @returns The absolute path to the specified library entry file.
 */
export type LibraryType = 'vue-components' | 'web-components' | 'functions'
export { basename, forge, generate, pki, tls, delimiter, dirname, dts, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath };
export default forge;
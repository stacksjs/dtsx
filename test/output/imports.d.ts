export declare function actionsPath(path?: string): string;
export declare function corePath(path?: string): string;
export declare function frameworkPath(path?: string, options?: { relative?: boolean, cwd?: string }): string;
export declare function storagePath(path?: string): string;
export declare function projectPath(filePath = '', options?: { relative: boolean }): string;
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
declare const absolutePath: unknown;
declare let path: unknown;
declare const finalPath: unknown;
declare const absolutePath: unknown;
declare const absolutePath: (frameworkPath(`actions/${path || ''}`)

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
  actionsPath: (path?: string)) => unknown;
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
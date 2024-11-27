import { actionsPath } from '@stacksjs/path';

declare type ParsedPath,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from 'node:path'
export declare function actionsPath(path?: string): string;
export declare function corePath(path?: string): string;
export declare function frameworkPath(path?: string, options?: { relative?: , boolean, cwd?: , string }): string;
export declare function storagePath(path?: string): string;
export declare function projectPath(filePath, options?: { relative: , boolean }): string;
export declare function userActionsPath(path?: string, options?: { relative: , true }): string;
export declare function builtUserActionsPath(path?: string, options?: { relative: , boolean }): string;
export declare function homeDir(path?: string): string;
export declare function libraryEntryPath(type: LibraryType): string;
export declare function examplesPath(type?: 'vue-components' | 'web-components'): string;

export { basename, delimiter, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath }
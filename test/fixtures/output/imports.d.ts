import { basename, delimiter, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { generate } from '@stacksjs/dtsx';
import forge, { pki, tls } from 'node-forge';
export declare function actionsPath(path?: string): string;
export declare function corePath(path?: string): string;
export declare function frameworkPath(path?: string, options?: { relative?: boolean, cwd?: string }): string;
export declare function storagePath(path?: string): string;
export declare function projectPath(filePath?: any, options?: { relative: boolean }): string;
export declare function userActionsPath(path?: string, options?: { relative: true }): string;
export declare function builtUserActionsPath(path?: string, options?: { relative: boolean }): string;
export declare function homeDir(path?: string): string;
export declare function libraryEntryPath(type: LibraryType): string;
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
export type LibraryType = 'vue-components' | 'web-components' | 'functions'
export { basename, forge, generate, pki, tls, delimiter, dirname, dts, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath };
export default forge;
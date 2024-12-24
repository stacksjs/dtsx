import forge, { pki, tls } from 'node-forge';
import { basename, delimiter, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { generate } from '@stacksjs/dtsx';
import { something as dts } from './generate';

export declare function actionsPath(path?: string): string;
export declare function corePath(path?: string): string;
export declare function frameworkPath(path?: string, options?: { relative?: , boolean, cwd?: , string }): string;
export declare function storagePath(path?: string): string;
export declare function projectPath(filePath, options?: { relative: , boolean }): string;
export declare function userActionsPath(path?: string, options?: { relative: , true }): string;
export declare function builtUserActionsPath(path?: string, options?: { relative: , boolean }): string;
export declare function homeDir(path?: string): string;
export declare type LibraryType = 'vue-components' | 'web-components' | 'functions'
export declare function libraryEntryPath(type: LibraryType): string;
export declare function examplesPath(type?: 'vue-components' | 'web-components'): string;

export { basename, forge, generate, pki, tls, delimiter, dirname, dts, extname, isAbsolute, join, normalize, relative, resolve, sep, toNamespacedPath }
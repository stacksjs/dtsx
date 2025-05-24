import type { ProcessingState } from './types';
/**
 * Extracts types from a TypeScript file and generates corresponding .d.ts content
 * @param filePath - Path to source TypeScript file
 */
export declare function extract(filePath: string): Promise<string>;
/**
 * Processes TypeScript source code and generates declaration types
 * @param sourceCode - TypeScript source code
 */
export declare function extractDtsTypes(sourceCode: string): string;
/**
 * Check if a given type string represents a function type
 */
export declare function isFunctionType(type: string): boolean;
/**
 * Check if a declaration is complete by examining its content
 * @param content - Content to check, either as a string or array of lines
 */
export declare function isDeclarationComplete(content: string | string[]): boolean;
export declare function processSpecificDeclaration(declarationWithoutComments: string, fullDeclaration: string, state: ProcessingState): void;
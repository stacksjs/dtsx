import type { ProcessingState } from './types';
export declare function extract(filePath: string): Promise<string>;
export declare function extractDtsTypes(sourceCode: string): string;
export declare function isFunctionType(type: string): boolean;
export declare function isDeclarationComplete(content: string | string[]): boolean;
export declare function processSpecificDeclaration(declarationWithoutComments: string, fullDeclaration: string, state: ProcessingState): void;
import type { FunctionSignature, ImportTrackingState, ProcessedMethod, ProcessingState } from './types';

declare function cleanParameterTypes(params: string): string;
declare function cleanSingleParameter(param: string): string;
export declare function extract(filePath: string): Promise<string>;
export declare function extractDtsTypes(sourceCode: string): string;
declare function extractFunctionSignature(declaration: string): FunctionSignature;
declare function extractFunctionName(declaration: string): string;
declare function extractGenerics(rest: string): void;
declare function extractParams(rest: string): void;
declare function extractReturnType(rest: string): void;
declare function extractFunctionType(value: string): string | null;
declare function generateOptimizedImports(state: ImportTrackingState): string[];
declare function extractCompleteObjectContent(value: string): string | null;
declare function formatOutput(state: ProcessingState): string;
declare function removeLeadingComments(code: string): string;
declare function createProcessingState(): ProcessingState;
declare function createImportTrackingState(): ImportTrackingState;
declare function indentMultilineType(type: string, baseIndent: string, isLast: boolean): string;
declare function inferValueType(value: string): string;
declare function inferArrayType(value: string, state?: ProcessingState, preserveLineBreaks?: boolean): string;
declare function inferComplexObjectType(value: string, state?: ProcessingState, indentLevel?: number): string;
declare function inferConstArrayType(value: string, state?: ProcessingState): string;
declare function inferConstType(value: string, state: ProcessingState): string;
declare function inferTypeFromDefaultValue(defaultValue: string): string;
declare function isDefaultExport(line: string): boolean;
declare function isDeclarationStart(line: string): boolean;
declare function isRegexPattern(line: string): boolean;
declare function isBrandedType(declaration: string): boolean;
export declare function isFunctionType(type: string): boolean;
export declare function isDeclarationComplete(content: string | string[]): boolean;
declare function isVariableInsideFunction(line: string, state: ProcessingState): boolean;
declare function needsMultilineFormat(types: string[]): boolean;
declare function normalizeTypeReference(value: string): string;
declare function processBlock(lines: string[], comments: string[], state: ProcessingState): void;
declare function processVariableBlock(cleanDeclaration: string, lines: string[], state: ProcessingState): boolean;
declare function processFunctionBlock(cleanDeclaration: string, state: ProcessingState): boolean;
declare function processInterfaceBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean;
declare function processTypeBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean;
declare function processDefaultExportBlock(cleanDeclaration: string, state: ProcessingState): boolean;
declare function processExportAllBlock(cleanDeclaration: string, state: ProcessingState): boolean;
declare function processExportBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean;
declare function processExport(line: string, state: ProcessingState): void;
declare function processExportedClass(cleanDeclaration: string, state: ProcessingState): boolean;
declare function processExportedEnum(cleanDeclaration: string, state: ProcessingState): boolean;
declare function processExportedNamespace(cleanDeclaration: string, state: ProcessingState): boolean;
declare function processModuleBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean;
export declare function processSpecificDeclaration(declarationWithoutComments: string, fullDeclaration: string, state: ProcessingState): void;
declare function processSourceFile(content: string, state: ProcessingState): void;
declare function processImports(line: string, state: ImportTrackingState): void;
declare function processType(declaration: string, isExported?: boolean): string;
declare function processTypeExport(line: string, state: ProcessingState): void;
declare function processVariable(declaration: string, isExported: boolean, state: ProcessingState): string;
declare function processFunction(declaration: string, usedTypes?: Set<string>, isExported?: boolean): string;
declare function getCleanDeclaration(declaration: string): string;
declare function processGeneratorFunction(declaration: string): string;
declare function processInterface(declaration: string, isExported?: boolean): string;
declare function processModule(declaration: string): string;
declare function processObjectMethod(declaration: string): ProcessedMethod;
declare function processObjectProperties(content: string, state?: ProcessingState, indentLevel?: number): Array<{ key: string, value: string }>;
declare function processPropertyValue(value: string, indentLevel: number, state?: ProcessingState): string;
declare function trackTypeUsage(content: string, state: ImportTrackingState): void;
declare function trackValueUsage(content: string, state: ImportTrackingState): void;
declare function debugLog(category: string, message: string): void;
declare function normalizeType(type: string): string;
declare function normalizePropertyKey(key: string): string;
declare function splitArrayElements(content: string): string[];
declare function splitFunctionDeclarations(content: string): string[];
import type { FunctionSignature, ImportTrackingState, ProcessedMethod, ProcessingState } from './types';
declare function cleanParameterTypes(params: string): string;
declare function cleanSingleParameter(param: string): string;
/**
* Extracts types from a TypeScript file and generates corresponding .d.ts content
* @param filePath - Path to source TypeScript file
*/
export declare async function extract(filePath: string): Promise<string>;
/**
* Processes TypeScript source code and generates declaration types
* @param sourceCode - TypeScript source code
*/
export declare function extractDtsTypes(sourceCode: string): string;
declare function extractFunctionSignature(declaration: string): FunctionSignature;
declare function extractFunctionName(declaration: string): string;
declare function extractGenerics(rest: string): void;
declare function extractParams(rest: string): void;
declare function extractReturnType(rest: string): void;
declare function extractFunctionType(value: string): string | null;
declare const parts: string[];
declare let current: string;
declare let depth: number;
declare let inString: boolean;
declare let stringChar: string;
declare let inDestructuring: unknown;
declare const result: unknown;
// Handle parameters with type annotations
declare const typeMatch: unknown;
// Handle parameters with default values but no explicit type
declare const defaultMatch: unknown;
declare const sourceCode: (await Bun.file(filePath).text()
    return extractDtsTypes(sourceCode)
  }
  catch (error) {
    console.error('Failed to extract types:', error)
    throw new Error('Failed to extract and generate .d.ts file')
  }
}

/**
 * Processes TypeScript source code and generates declaration types
 * @param sourceCode - TypeScript source code
 */
export function extractDtsTypes(sourceCode: string): string {
  const state = createProcessingState()
  // debugLog('init', 'Starting DTS extraction')

  // Process imports first
  sourceCode.split('\n').forEach((line)) => unknown;
// Look ahead to see if this is followed by a function body
declare const nextNonWhitespace: (rest.slice(i + 1).trim()[0]
            if (nextNonWhitespace === '{') {
              debugLog('return-end', `Found end of return type at pos ${i}, next char is function body`)
              foundEnd = true
              break
            }
          }
        }

        // Stop at semicolons at depth 0
        if (depth === 0 && char === ';') {
          debugLog('return-end', 'Found semicolon at depth 0')
          foundEnd = true
          break
        }
      }

      buffer += char
      debugLog('return-buffer', `Updated buffer: ${buffer}`)
      i++
    }

    returnType = buffer.trim()
    debugLog('return-final', `Final extracted return type: ${returnType}`)
  }
  return { returnType }
}

function extractFunctionType(value: string): string | null {
  debugLog('extract-function', `Extracting function type from: ${value}`)

  const cleanValue = value.trim()
  let pos = 0
  const length = cleanValue.length

  // Check if the value starts with '(' (function expression)
  if (!cleanValue.startsWith('(')) {
    // Handle function keyword with explicit parameter types
    const funcMatch = cleanValue.match(/^function\s*\w*\s*\((.*?)\)/s)
    if (funcMatch) {
      const [, params] = funcMatch
      // Clean parameters while preserving type annotations
      const cleanParams = cleanParameterTypes(params || '')
      // Extract return type if available
      const returnTypeMatch = cleanValue.match(/\):\s*([^{;]+)(?:[{;]|$)/)
      const returnType = returnTypeMatch ? normalizeType(returnTypeMatch[1]) : 'unknown'
      return `(${cleanParams})) => unknown;
declare interface BracketInfo {
    char: string
    indent: string
    isArray: boolean
    depth: number
    isSingleElement?: boolean
  }
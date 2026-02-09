/**
 * Triple-slash directive extraction — NO TypeScript dependency.
 * Pure string processing for maximum startup speed.
 */

/**
 * Extract triple-slash directives from source code.
 * These are special comments like /// <reference types="..." />
 */
export function extractTripleSlashDirectives(sourceCode: string): string[] {
  const directives: string[] = []
  let lineStart = 0

  // Scan line-by-line without splitting the entire source (stops early for large files)
  for (let i = 0; i <= sourceCode.length; i++) {
    if (i === sourceCode.length || sourceCode[i] === '\n') {
      // Extract and trim the current line
      let start = lineStart
      let end = i
      while (start < end && (sourceCode[start] === ' ' || sourceCode[start] === '\t' || sourceCode[start] === '\r')) start++
      while (end > start && (sourceCode[end - 1] === ' ' || sourceCode[end - 1] === '\t' || sourceCode[end - 1] === '\r')) end--
      const trimmed = sourceCode.slice(start, end)
      lineStart = i + 1

      // Triple-slash directives must be at the very beginning of the file
      // (only whitespace and other triple-slash directives can precede them)
      if (trimmed.startsWith('///')) {
        if (trimmed.match(/^\/\/\/\s*<reference\s+(path|types|lib|no-default-lib)\s*=\s*["'][^"']+["']\s*\/>/)) {
          directives.push(trimmed)
        }
        else if (trimmed.match(/^\/\/\/\s*<amd-module\s+name\s*=\s*["'][^"']+["']\s*\/>/)) {
          directives.push(trimmed)
        }
        else if (trimmed.match(/^\/\/\/\s*<amd-dependency\s+path\s*=\s*["'][^"']+["']/)) {
          directives.push(trimmed)
        }
      }
      else if (trimmed === '' || trimmed.startsWith('//')) {
        continue
      }
      else {
        break
      }
    }
  }

  return directives
}

/**
 * Diff module for comparing declaration files
 * Shows changes between existing and newly generated .d.ts files
 */

import { file } from './compat'

/**
 * Diff operation type
 */
export type DiffOperation = 'add' | 'remove' | 'equal'

/**
 * A single diff hunk (change)
 */
export interface DiffHunk {
  /** Operation type */
  operation: DiffOperation
  /** Lines in this hunk */
  lines: string[]
  /** Starting line number in old file (1-indexed) */
  oldStart: number
  /** Number of lines in old file */
  oldCount: number
  /** Starting line number in new file (1-indexed) */
  newStart: number
  /** Number of lines in new file */
  newCount: number
}

/**
 * Complete diff result
 */
export interface DiffResult {
  /** File path */
  filePath: string
  /** Whether files are identical */
  identical: boolean
  /** All hunks/changes */
  hunks: DiffHunk[]
  /** Statistics */
  stats: {
    additions: number
    deletions: number
    unchanged: number
  }
  /** Old content (if available) */
  oldContent?: string
  /** New content */
  newContent: string
}

/**
 * Options for diff generation
 */
export interface DiffOptions {
  /** Number of context lines around changes */
  context?: number
  /** Ignore whitespace changes */
  ignoreWhitespace?: boolean
  /** Ignore blank lines */
  ignoreBlankLines?: boolean
  /** Treat as new file if old doesn't exist */
  treatMissingAsEmpty?: boolean
}

/**
 * Compute the longest common subsequence table
 */
function computeLCSTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length
  const n = newLines.length
  const table: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1
      }
      else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1])
      }
    }
  }

  return table
}

/**
 * Backtrack through LCS table to get diff operations
 */
function backtrackLCS(
  table: number[][],
  oldLines: string[],
  newLines: string[],
  i: number,
  j: number,
): Array<{ op: DiffOperation, oldIdx?: number, newIdx?: number, line: string }> {
  const result: Array<{ op: DiffOperation, oldIdx?: number, newIdx?: number, line: string }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ op: 'equal', oldIdx: i - 1, newIdx: j - 1, line: oldLines[i - 1] })
      i--
      j--
    }
    else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      result.unshift({ op: 'add', newIdx: j - 1, line: newLines[j - 1] })
      j--
    }
    else if (i > 0) {
      result.unshift({ op: 'remove', oldIdx: i - 1, line: oldLines[i - 1] })
      i--
    }
  }

  return result
}

/**
 * Normalize line for comparison
 */
function normalizeLine(line: string, options: DiffOptions): string {
  let normalized = line

  if (options.ignoreWhitespace) {
    // Collapse all whitespace to single space
    normalized = normalized.replace(/\s+/g, ' ').trim()
  }

  return normalized
}

/**
 * Compute diff between two strings
 */
export function computeDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  options: DiffOptions = {},
): DiffResult {
  const { context = 3, ignoreWhitespace = false, ignoreBlankLines = false } = options

  // Split into lines
  let oldLines = oldContent.split('\n')
  let newLines = newContent.split('\n')

  // Remove trailing empty line if present (common in files)
  if (oldLines[oldLines.length - 1] === '') oldLines.pop()
  if (newLines[newLines.length - 1] === '') newLines.pop()

  // Apply normalization for comparison
  const oldNormalized = oldLines.map(l => normalizeLine(l, { ignoreWhitespace }))
  const newNormalized = newLines.map(l => normalizeLine(l, { ignoreWhitespace }))

  // Filter blank lines if needed
  let oldFiltered = oldNormalized
  let newFiltered = newNormalized
  let oldMapping: number[] = oldLines.map((_, i) => i)
  let newMapping: number[] = newLines.map((_, i) => i)

  if (ignoreBlankLines) {
    oldFiltered = []
    newFiltered = []
    oldMapping = []
    newMapping = []

    oldNormalized.forEach((line, i) => {
      if (line.trim()) {
        oldFiltered.push(line)
        oldMapping.push(i)
      }
    })

    newNormalized.forEach((line, i) => {
      if (line.trim()) {
        newFiltered.push(line)
        newMapping.push(i)
      }
    })
  }

  // Compute LCS
  const table = computeLCSTable(oldFiltered, newFiltered)
  const operations = backtrackLCS(table, oldFiltered, newFiltered, oldFiltered.length, newFiltered.length)

  // Check if identical
  const identical = operations.every(op => op.op === 'equal')

  // Calculate stats
  let additions = 0
  let deletions = 0
  let unchanged = 0

  for (const op of operations) {
    if (op.op === 'add') additions++
    else if (op.op === 'remove') deletions++
    else unchanged++
  }

  // Group operations into hunks with context
  const hunks = createHunks(operations, oldLines, newLines, oldMapping, newMapping, context)

  return {
    filePath,
    identical,
    hunks,
    stats: { additions, deletions, unchanged },
    oldContent,
    newContent,
  }
}

/**
 * Create hunks from operations with context lines
 */
function createHunks(
  operations: Array<{ op: DiffOperation, oldIdx?: number, newIdx?: number, line: string }>,
  oldLines: string[],
  newLines: string[],
  _oldMapping: number[],
  _newMapping: number[],
  context: number,
): DiffHunk[] {
  const hunks: DiffHunk[] = []

  // Find change regions
  const changes: number[] = []
  operations.forEach((op, i) => {
    if (op.op !== 'equal') {
      changes.push(i)
    }
  })

  if (changes.length === 0) {
    return hunks
  }

  // Group changes that are close together
  const groups: number[][] = []
  let currentGroup: number[] = [changes[0]]

  for (let i = 1; i < changes.length; i++) {
    if (changes[i] - changes[i - 1] <= context * 2 + 1) {
      currentGroup.push(changes[i])
    }
    else {
      groups.push(currentGroup)
      currentGroup = [changes[i]]
    }
  }
  groups.push(currentGroup)

  // Create hunks for each group
  for (const group of groups) {
    const start = Math.max(0, group[0] - context)
    const end = Math.min(operations.length - 1, group[group.length - 1] + context)

    const hunkOps = operations.slice(start, end + 1)
    const lines: string[] = []

    let oldStart = 1
    let newStart = 1
    let oldCount = 0
    let newCount = 0

    // Find starting positions
    for (let i = 0; i < start; i++) {
      const op = operations[i]
      if (op.op === 'equal' || op.op === 'remove') oldStart++
      if (op.op === 'equal' || op.op === 'add') newStart++
    }

    // Build hunk content
    for (const op of hunkOps) {
      if (op.op === 'equal') {
        lines.push(` ${op.line}`)
        oldCount++
        newCount++
      }
      else if (op.op === 'remove') {
        lines.push(`-${op.line}`)
        oldCount++
      }
      else if (op.op === 'add') {
        lines.push(`+${op.line}`)
        newCount++
      }
    }

    hunks.push({
      operation: 'equal', // This is a mixed hunk
      lines,
      oldStart,
      oldCount,
      newStart,
      newCount,
    })
  }

  return hunks
}

/**
 * Format diff result as unified diff string
 */
export function formatUnifiedDiff(result: DiffResult): string {
  if (result.identical) {
    return ''
  }

  const lines: string[] = []

  // Header
  lines.push(`--- a/${result.filePath}`)
  lines.push(`+++ b/${result.filePath}`)

  // Hunks
  for (const hunk of result.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)
    lines.push(...hunk.lines)
  }

  return lines.join('\n')
}

/**
 * Format diff with colors for terminal output
 */
export function formatColoredDiff(result: DiffResult): string {
  if (result.identical) {
    return `\x1b[32m✓ ${result.filePath} (unchanged)\x1b[0m`
  }

  const lines: string[] = []

  // Header with stats
  const statsStr = `+${result.stats.additions} -${result.stats.deletions}`
  lines.push(`\x1b[1m${result.filePath}\x1b[0m \x1b[90m(${statsStr})\x1b[0m`)
  lines.push('')

  // Hunks
  for (const hunk of result.hunks) {
    lines.push(`\x1b[36m@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\x1b[0m`)

    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        lines.push(`\x1b[32m${line}\x1b[0m`)
      }
      else if (line.startsWith('-')) {
        lines.push(`\x1b[31m${line}\x1b[0m`)
      }
      else {
        lines.push(`\x1b[90m${line}\x1b[0m`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format diff as simple summary
 */
export function formatDiffSummary(result: DiffResult): string {
  if (result.identical) {
    return `${result.filePath}: unchanged`
  }

  return `${result.filePath}: +${result.stats.additions} -${result.stats.deletions} lines`
}

/**
 * Compare a file against new content
 */
export async function diffFile(
  filePath: string,
  newContent: string,
  options: DiffOptions = {},
): Promise<DiffResult> {
  let oldContent = ''

  try {
    const fileHandle = file(filePath)
    if (await fileHandle.exists()) {
      oldContent = await fileHandle.text()
    }
    else if (!options.treatMissingAsEmpty) {
      // Treat as all additions
      return computeDiff('', newContent, filePath, options)
    }
  }
  catch {
    // File doesn't exist or can't be read
    if (!options.treatMissingAsEmpty) {
      return computeDiff('', newContent, filePath, options)
    }
  }

  return computeDiff(oldContent, newContent, filePath, options)
}

/**
 * Compare multiple files
 */
export async function diffFiles(
  files: Map<string, string>,
  options: DiffOptions = {},
): Promise<Map<string, DiffResult>> {
  const results = new Map<string, DiffResult>()

  for (const [filePath, newContent] of files) {
    const result = await diffFile(filePath, newContent, options)
    results.set(filePath, result)
  }

  return results
}

/**
 * Generate a summary of all diffs
 */
export function summarizeDiffs(results: Map<string, DiffResult>): {
  totalFiles: number
  changedFiles: number
  unchangedFiles: number
  totalAdditions: number
  totalDeletions: number
  newFiles: number
} {
  let changedFiles = 0
  let unchangedFiles = 0
  let totalAdditions = 0
  let totalDeletions = 0
  let newFiles = 0

  for (const result of results.values()) {
    if (result.identical) {
      unchangedFiles++
    }
    else {
      changedFiles++
      totalAdditions += result.stats.additions
      totalDeletions += result.stats.deletions

      if (!result.oldContent) {
        newFiles++
      }
    }
  }

  return {
    totalFiles: results.size,
    changedFiles,
    unchangedFiles,
    totalAdditions,
    totalDeletions,
    newFiles,
  }
}

/**
 * Print colored diff to console
 */
export function printDiff(result: DiffResult): void {
  console.log(formatColoredDiff(result))
}

/**
 * Print all diffs to console
 */
export function printDiffs(results: Map<string, DiffResult>, showUnchanged = false): void {
  for (const result of results.values()) {
    if (result.identical && !showUnchanged) {
      continue
    }
    printDiff(result)
  }

  // Print summary
  const summary = summarizeDiffs(results)
  console.log('')
  console.log(`\x1b[1mSummary:\x1b[0m ${summary.totalFiles} files, ${summary.changedFiles} changed, ${summary.unchangedFiles} unchanged`)

  if (summary.changedFiles > 0) {
    console.log(`         \x1b[32m+${summary.totalAdditions}\x1b[0m \x1b[31m-${summary.totalDeletions}\x1b[0m lines`)
  }

  if (summary.newFiles > 0) {
    console.log(`         ${summary.newFiles} new files`)
  }
}

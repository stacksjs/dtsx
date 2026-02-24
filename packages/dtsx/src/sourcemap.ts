/**
 * Source map support for .d.ts files
 * Maps generated declarations back to original source positions
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'

/**
 * Source map configuration
 */
export interface SourceMapConfig {
  /**
   * Generate source maps
   * @default false
   */
  sourceMap?: boolean

  /**
   * Inline source maps in .d.ts files
   * @default false
   */
  inlineSourceMap?: boolean

  /**
   * Include source content in source maps
   * @default false
   */
  inlineSources?: boolean

  /**
   * Source root path
   */
  sourceRoot?: string

  /**
   * Map file extension
   * @default '.d.ts.map'
   */
  mapExtension?: string
}

/**
 * Source map v3 format
 */
export interface SourceMapV3 {
  version: 3
  file: string
  sourceRoot?: string
  sources: string[]
  sourcesContent?: (string | null)[]
  names: string[]
  mappings: string
}

/**
 * Source position
 */
export interface SourcePosition {
  line: number // 0-indexed
  column: number // 0-indexed
}

/**
 * Mapping entry
 */
export interface Mapping {
  /** Generated position */
  generated: SourcePosition
  /** Original position */
  original: SourcePosition
  /** Source file index */
  sourceIndex: number
  /** Name index (optional) */
  nameIndex?: number
}

/**
 * Source map generator
 */
export class SourceMapGenerator {
  private file: string
  private sourceRoot?: string
  private sources: string[] = []
  private sourcesContent: (string | null)[] = []
  private names: string[] = []
  private mappings: Mapping[] = []
  private sourceIndexMap = new Map<string, number>()
  private nameIndexMap = new Map<string, number>()

  constructor(options: { file: string, sourceRoot?: string }) {
    this.file = options.file
    this.sourceRoot = options.sourceRoot
  }

  /**
   * Add a source file
   */
  addSource(source: string, content?: string): number {
    let index = this.sourceIndexMap.get(source)
    if (index === undefined) {
      index = this.sources.length
      this.sources.push(source)
      this.sourcesContent.push(content ?? null)
      this.sourceIndexMap.set(source, index)
    }
    else if (content && !this.sourcesContent[index]) {
      this.sourcesContent[index] = content
    }
    return index
  }

  /**
   * Add a name
   */
  addName(name: string): number {
    let index = this.nameIndexMap.get(name)
    if (index === undefined) {
      index = this.names.length
      this.names.push(name)
      this.nameIndexMap.set(name, index)
    }
    return index
  }

  /**
   * Add a mapping
   */
  addMapping(mapping: {
    generated: SourcePosition
    original: SourcePosition
    source: string
    name?: string
  }): void {
    const sourceIndex = this.addSource(mapping.source)
    let nameIndex: number | undefined

    if (mapping.name) {
      nameIndex = this.addName(mapping.name)
    }

    this.mappings.push({
      generated: mapping.generated,
      original: mapping.original,
      sourceIndex,
      nameIndex,
    })
  }

  /**
   * Generate the source map
   */
  generate(includeContent = false): SourceMapV3 {
    // Sort mappings by generated position
    this.mappings.sort((a, b) => {
      if (a.generated.line !== b.generated.line) {
        return a.generated.line - b.generated.line
      }
      return a.generated.column - b.generated.column
    })

    const map: SourceMapV3 = {
      version: 3,
      file: this.file,
      sources: this.sources,
      names: this.names,
      mappings: this.encodeMappings(),
    }

    if (this.sourceRoot) {
      map.sourceRoot = this.sourceRoot
    }

    if (includeContent) {
      map.sourcesContent = this.sourcesContent
    }

    return map
  }

  /**
   * Encode mappings to VLQ string
   */
  private encodeMappings(): string {
    const lines: string[] = []
    let currentLine = 0
    let previousGeneratedColumn = 0
    let previousSourceIndex = 0
    let previousOriginalLine = 0
    let previousOriginalColumn = 0
    let previousNameIndex = 0

    let currentLineSegments: string[] = []

    for (const mapping of this.mappings) {
      // Handle line breaks
      while (currentLine < mapping.generated.line) {
        lines.push(currentLineSegments.join(','))
        currentLineSegments = []
        currentLine++
        previousGeneratedColumn = 0
      }

      const segment: number[] = []

      // Generated column (relative to previous)
      segment.push(mapping.generated.column - previousGeneratedColumn)
      previousGeneratedColumn = mapping.generated.column

      // Source index (relative)
      segment.push(mapping.sourceIndex - previousSourceIndex)
      previousSourceIndex = mapping.sourceIndex

      // Original line (relative)
      segment.push(mapping.original.line - previousOriginalLine)
      previousOriginalLine = mapping.original.line

      // Original column (relative)
      segment.push(mapping.original.column - previousOriginalColumn)
      previousOriginalColumn = mapping.original.column

      // Name index (relative, optional)
      if (mapping.nameIndex !== undefined) {
        segment.push(mapping.nameIndex - previousNameIndex)
        previousNameIndex = mapping.nameIndex
      }

      currentLineSegments.push(encodeVLQ(segment))
    }

    // Push last line
    lines.push(currentLineSegments.join(','))

    return lines.join(';')
  }

  /**
   * Convert to JSON string
   */
  toString(includeContent = false): string {
    return JSON.stringify(this.generate(includeContent))
  }

  /**
   * Convert to base64 data URL
   */
  toDataUrl(includeContent = false): string {
    const json = this.toString(includeContent)
    const base64 = Buffer.from(json).toString('base64')
    return `data:application/json;charset=utf-8;base64,${base64}`
  }

  /**
   * Generate inline source map comment
   */
  toComment(includeContent = false): string {
    return `//# sourceMappingURL=${this.toDataUrl(includeContent)}`
  }
}

/**
 * Source map consumer for reading source maps
 */
export class SourceMapConsumer {
  private map: SourceMapV3
  private decodedMappings: Mapping[] | null = null

  constructor(map: SourceMapV3 | string) {
    this.map = typeof map === 'string' ? JSON.parse(map) : map
  }

  /**
   * Get original position for a generated position
   */
  originalPositionFor(generated: SourcePosition): {
    source: string | null
    line: number | null
    column: number | null
    name: string | null
  } {
    const mappings = this.getMappings()

    // Binary search for the closest mapping
    let low = 0
    let high = mappings.length - 1
    let closest: Mapping | null = null

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const mapping = mappings[mid]

      if (mapping.generated.line === generated.line) {
        if (mapping.generated.column === generated.column) {
          closest = mapping
          break
        }
        else if (mapping.generated.column < generated.column) {
          closest = mapping
          low = mid + 1
        }
        else {
          high = mid - 1
        }
      }
      else if (mapping.generated.line < generated.line) {
        low = mid + 1
      }
      else {
        high = mid - 1
      }
    }

    if (!closest) {
      return { source: null, line: null, column: null, name: null }
    }

    return {
      source: this.map.sources[closest.sourceIndex] || null,
      line: closest.original.line,
      column: closest.original.column,
      name: closest.nameIndex !== undefined ? this.map.names[closest.nameIndex] : null,
    }
  }

  /**
   * Get generated position for an original position
   */
  generatedPositionFor(original: {
    source: string
    line: number
    column: number
  }): SourcePosition | null {
    const sourceIndex = this.map.sources.indexOf(original.source)
    if (sourceIndex === -1) {
      return null
    }

    const mappings = this.getMappings()

    for (const mapping of mappings) {
      if (
        mapping.sourceIndex === sourceIndex
        && mapping.original.line === original.line
        && mapping.original.column <= original.column
      ) {
        return mapping.generated
      }
    }

    return null
  }

  /**
   * Get all mappings
   */
  private getMappings(): Mapping[] {
    if (!this.decodedMappings) {
      this.decodedMappings = decodeMappings(this.map.mappings)
    }
    return this.decodedMappings
  }

  /**
   * Get source content if available
   */
  sourceContentFor(source: string): string | null {
    const index = this.map.sources.indexOf(source)
    if (index === -1 || !this.map.sourcesContent) {
      return null
    }
    return this.map.sourcesContent[index]
  }
}

/**
 * Encode numbers to VLQ string
 */
function encodeVLQ(values: number[]): string {
  return values.map(encodeVLQValue).join('')
}

/**
 * Encode a single value to VLQ
 */
function encodeVLQValue(value: number): string {
  const _VLQ_BASE = 32 // 2^5
  const VLQ_CONTINUATION_BIT = 32 // 0b100000
  const VLQ_BASE_MASK = 31 // 0b11111

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  let result = ''

  // Convert to unsigned (sign bit in LSB)
  let unsigned = value < 0 ? ((-value) << 1) | 1 : value << 1

  do {
    let digit = unsigned & VLQ_BASE_MASK
    unsigned >>>= 5

    if (unsigned > 0) {
      digit |= VLQ_CONTINUATION_BIT
    }

    result += chars[digit]
  } while (unsigned > 0)

  return result
}

/**
 * Decode VLQ mappings string
 */
function decodeMappings(mappings: string): Mapping[] {
  const result: Mapping[] = []
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  let line = 0
  let generatedColumn = 0
  let sourceIndex = 0
  let originalLine = 0
  let originalColumn = 0
  let nameIndex = 0

  const segments = mappings.split(';')

  for (const lineSegments of segments) {
    generatedColumn = 0

    if (lineSegments) {
      const segmentStrs = lineSegments.split(',')

      for (const segment of segmentStrs) {
        if (!segment)
          continue

        const values = decodeVLQSegment(segment, chars)

        if (values.length >= 1) {
          generatedColumn += values[0]
        }

        if (values.length >= 4) {
          sourceIndex += values[1]
          originalLine += values[2]
          originalColumn += values[3]

          const mapping: Mapping = {
            generated: { line, column: generatedColumn },
            original: { line: originalLine, column: originalColumn },
            sourceIndex,
          }

          if (values.length >= 5) {
            nameIndex += values[4]
            mapping.nameIndex = nameIndex
          }

          result.push(mapping)
        }
      }
    }

    line++
  }

  return result
}

/**
 * Decode a VLQ segment
 */
function decodeVLQSegment(segment: string, chars: string): number[] {
  const VLQ_CONTINUATION_BIT = 32

  const values: number[] = []
  let shift = 0
  let value = 0

  for (const char of segment) {
    const digit = chars.indexOf(char)
    if (digit === -1)
      continue

    const hasContinuation = digit & VLQ_CONTINUATION_BIT
    value += (digit & 31) << shift

    if (hasContinuation) {
      shift += 5
    }
    else {
      // Convert from unsigned
      const negate = value & 1
      value >>= 1
      values.push(negate ? -value : value)

      value = 0
      shift = 0
    }
  }

  return values
}

/**
 * Create source map for generated .d.ts content
 */
export function createSourceMap(options: {
  generatedFile: string
  sourceFile: string
  sourceContent?: string
  sourceRoot?: string
  mappings: Array<{
    generatedLine: number
    generatedColumn: number
    originalLine: number
    originalColumn: number
    name?: string
  }>
}): SourceMapGenerator {
  const generator = new SourceMapGenerator({
    file: basename(options.generatedFile),
    sourceRoot: options.sourceRoot,
  })

  const relativeSource = relative(
    dirname(options.generatedFile),
    options.sourceFile,
  )

  generator.addSource(relativeSource, options.sourceContent)

  for (const m of options.mappings) {
    generator.addMapping({
      generated: { line: m.generatedLine, column: m.generatedColumn },
      original: { line: m.originalLine, column: m.originalColumn },
      source: relativeSource,
      name: m.name,
    })
  }

  return generator
}

/**
 * Append source map comment to content
 */
export function appendSourceMapComment(
  content: string,
  mapFileName: string,
): string {
  return `${content}\n//# sourceMappingURL=${mapFileName}`
}

/**
 * Append inline source map to content
 */
export function appendInlineSourceMap(
  content: string,
  generator: SourceMapGenerator,
  includeContent = false,
): string {
  return `${content}\n${generator.toComment(includeContent)}`
}

/**
 * Write source map file
 */
export async function writeSourceMap(
  mapPath: string,
  generator: SourceMapGenerator,
  includeContent = false,
): Promise<void> {
  await writeFile(mapPath, generator.toString(includeContent))
}

/**
 * Read and parse source map file
 */
export async function readSourceMap(mapPath: string): Promise<SourceMapConsumer> {
  const content = await readFile(mapPath, 'utf-8')
  return new SourceMapConsumer(content)
}

/**
 * Extract source map from content (inline or reference)
 */
export async function extractSourceMap(
  content: string,
  filePath: string,
): Promise<SourceMapConsumer | null> {
  // Check for inline source map
  const inlineMatch = content.match(
    /\/\/# sourceMappingURL=data:application\/json[^,]+,(\S+)/,
  )

  if (inlineMatch) {
    const base64 = inlineMatch[1]
    const json = Buffer.from(base64, 'base64').toString('utf-8')
    return new SourceMapConsumer(json)
  }

  // Check for external source map reference
  const refMatch = content.match(/\/\/# sourceMappingURL=(.+)$/)

  if (refMatch) {
    const mapPath = resolve(dirname(filePath), refMatch[1].trim())
    try {
      return await readSourceMap(mapPath)
    }
    catch {
      return null
    }
  }

  return null
}

/**
 * Build source mappings from declaration info
 */
export function buildDeclarationMappings(
  _generatedContent: string,
  _declarationInfos: Array<{
    name: string
    generatedStart: number
    originalLine: number
    originalColumn: number
  }>,
): Array<{
    generatedLine: number
    generatedColumn: number
    originalLine: number
    originalColumn: number
    name: string
  }> {
  const generatedContent = _generatedContent
  const declarationInfos = _declarationInfos
  const lines = generatedContent.split('\n')
  const mappings: Array<{
    generatedLine: number
    generatedColumn: number
    originalLine: number
    originalColumn: number
    name: string
  }> = []

  let currentPos = 0
  let currentLine = 0

  for (const info of declarationInfos) {
    // Find the line number for this position
    while (currentPos + lines[currentLine].length + 1 <= info.generatedStart && currentLine < lines.length - 1) {
      currentPos += lines[currentLine].length + 1 // +1 for newline
      currentLine++
    }

    const column = info.generatedStart - currentPos

    mappings.push({
      generatedLine: currentLine,
      generatedColumn: Math.max(0, column),
      originalLine: info.originalLine,
      originalColumn: info.originalColumn,
      name: info.name,
    })
  }

  return mappings
}

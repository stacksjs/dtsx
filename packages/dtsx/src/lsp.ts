import type { Declaration, DtsGenerationConfig } from './types'
import { existsSync, readFileSync, watchFile, unwatchFile } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { extractDeclarations } from './extractor'
import { processDeclarations } from './processor'

/**
 * LSP message types
 */
export interface LSPMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: any
  result?: any
  error?: LSPError
}

export interface LSPError {
  code: number
  message: string
  data?: any
}

/**
 * LSP initialization params
 */
export interface InitializeParams {
  processId: number | null
  rootUri: string | null
  capabilities: ClientCapabilities
}

export interface ClientCapabilities {
  textDocument?: {
    synchronization?: {
      dynamicRegistration?: boolean
      willSave?: boolean
      didSave?: boolean
    }
    hover?: {
      dynamicRegistration?: boolean
      contentFormat?: string[]
    }
    completion?: {
      dynamicRegistration?: boolean
      completionItem?: {
        snippetSupport?: boolean
        documentationFormat?: string[]
      }
    }
    definition?: {
      dynamicRegistration?: boolean
    }
    diagnostic?: {
      dynamicRegistration?: boolean
    }
  }
  workspace?: {
    workspaceFolders?: boolean
    configuration?: boolean
  }
}

export interface ServerCapabilities {
  textDocumentSync?: number
  hoverProvider?: boolean
  completionProvider?: {
    triggerCharacters?: string[]
    resolveProvider?: boolean
  }
  definitionProvider?: boolean
  diagnosticProvider?: {
    interFileDependencies: boolean
    workspaceDiagnostics: boolean
  }
}

/**
 * Text document item
 */
export interface TextDocumentItem {
  uri: string
  languageId: string
  version: number
  text: string
}

/**
 * Position in a text document
 */
export interface Position {
  line: number
  character: number
}

/**
 * Range in a text document
 */
export interface Range {
  start: Position
  end: Position
}

/**
 * Diagnostic severity
 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/**
 * Diagnostic message
 */
export interface Diagnostic {
  range: Range
  severity?: DiagnosticSeverity
  code?: string | number
  source?: string
  message: string
}

/**
 * Hover response
 */
export interface Hover {
  contents: string | { kind: string, value: string }
  range?: Range
}

/**
 * Location for go-to-definition
 */
export interface Location {
  uri: string
  range: Range
}

/**
 * LSP Server for dtsx
 */
export class DtsxLanguageServer {
  private documents = new Map<string, { content: string, version: number, declarations: Declaration[] }>()
  private rootUri: string | null = null
  private config: Partial<DtsGenerationConfig> = {}
  private messageId = 0
  private watchers = new Map<string, ReturnType<typeof watchFile>>()

  /**
   * Initialize the server
   */
  initialize(params: InitializeParams): { capabilities: ServerCapabilities } {
    this.rootUri = params.rootUri

    return {
      capabilities: {
        textDocumentSync: 1, // Full sync
        hoverProvider: true,
        completionProvider: {
          triggerCharacters: ['.', ':', '<'],
          resolveProvider: false,
        },
        definitionProvider: true,
        diagnosticProvider: {
          interFileDependencies: false,
          workspaceDiagnostics: false,
        },
      },
    }
  }

  /**
   * Handle document open
   */
  didOpen(params: { textDocument: TextDocumentItem }): void {
    const { uri, text, version } = params.textDocument
    this.updateDocument(uri, text, version)
  }

  /**
   * Handle document change
   */
  didChange(params: { textDocument: { uri: string, version: number }, contentChanges: Array<{ text: string }> }): void {
    const { uri, version } = params.textDocument
    const text = params.contentChanges[0]?.text || ''
    this.updateDocument(uri, text, version)
  }

  /**
   * Handle document close
   */
  didClose(params: { textDocument: { uri: string } }): void {
    const uri = params.textDocument.uri
    this.documents.delete(uri)

    // Stop watching
    const watcher = this.watchers.get(uri)
    if (watcher) {
      unwatchFile(this.uriToPath(uri))
      this.watchers.delete(uri)
    }
  }

  /**
   * Update document and extract declarations
   */
  private updateDocument(uri: string, content: string, version: number): void {
    const filePath = this.uriToPath(uri)
    const declarations = extractDeclarations(content, filePath, true)

    this.documents.set(uri, { content, version, declarations })
  }

  /**
   * Get diagnostics for a document
   */
  getDiagnostics(uri: string): Diagnostic[] {
    const doc = this.documents.get(uri)
    if (!doc) return []

    const diagnostics: Diagnostic[] = []

    // Check for common issues
    for (const decl of doc.declarations) {
      // Check for missing type annotations on exported values
      if (decl.isExported && decl.kind === 'variable' && !decl.typeAnnotation) {
        diagnostics.push({
          range: this.getDeclarationRange(decl, doc.content),
          severity: DiagnosticSeverity.Warning,
          code: 'missing-type',
          source: 'dtsx',
          message: `Exported variable '${decl.name}' should have an explicit type annotation for better declaration generation`,
        })
      }

      // Check for any types
      if (decl.typeAnnotation === 'any' || decl.returnType === 'any') {
        diagnostics.push({
          range: this.getDeclarationRange(decl, doc.content),
          severity: DiagnosticSeverity.Information,
          code: 'any-type',
          source: 'dtsx',
          message: `Consider using a more specific type instead of 'any'`,
        })
      }

      // Check for functions without return type
      if (decl.kind === 'function' && decl.isExported && !decl.returnType) {
        diagnostics.push({
          range: this.getDeclarationRange(decl, doc.content),
          severity: DiagnosticSeverity.Information,
          code: 'missing-return-type',
          source: 'dtsx',
          message: `Function '${decl.name}' should have an explicit return type for better declaration generation`,
        })
      }
    }

    return diagnostics
  }

  /**
   * Handle hover request
   */
  hover(params: { textDocument: { uri: string }, position: Position }): Hover | null {
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc) return null

    const { line, character } = params.position
    const lines = doc.content.split('\n')
    const lineText = lines[line] || ''

    // Find word at position
    const wordMatch = lineText.slice(0, character).match(/[\w$]+$/)
    const afterMatch = lineText.slice(character).match(/^[\w$]+/)

    if (!wordMatch && !afterMatch) return null

    const word = (wordMatch?.[0] || '') + (afterMatch?.[0] || '')

    // Find declaration for this word
    const decl = doc.declarations.find(d => d.name === word)
    if (!decl) return null

    // Generate hover content
    const signature = this.buildSignature(decl)
    let content = `\`\`\`typescript\n${signature}\n\`\`\``

    // Add JSDoc description if available
    if (decl.leadingComments && decl.leadingComments.length > 0) {
      const jsdoc = decl.leadingComments.join('\n')
      const descMatch = jsdoc.match(/\*\s*([^@*][^*]*)/m)
      if (descMatch) {
        content += `\n\n${descMatch[1].trim()}`
      }
    }

    return {
      contents: {
        kind: 'markdown',
        value: content,
      },
    }
  }

  /**
   * Handle completion request
   */
  completion(params: { textDocument: { uri: string }, position: Position }): Array<{ label: string, kind: number, detail?: string, documentation?: string }> {
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc) return []

    const items: Array<{ label: string, kind: number, detail?: string, documentation?: string }> = []

    // Add all exported declarations as completion items
    for (const decl of doc.declarations) {
      if (!decl.isExported) continue

      let kind = 6 // Variable
      switch (decl.kind) {
        case 'function': kind = 3; break
        case 'class': kind = 7; break
        case 'interface': kind = 8; break
        case 'type': kind = 8; break
        case 'enum': kind = 13; break
      }

      items.push({
        label: decl.name,
        kind,
        detail: this.buildSignature(decl),
      })
    }

    return items
  }

  /**
   * Handle go-to-definition request
   */
  definition(params: { textDocument: { uri: string }, position: Position }): Location | null {
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc) return null

    const { line, character } = params.position
    const lines = doc.content.split('\n')
    const lineText = lines[line] || ''

    // Find word at position
    const wordMatch = lineText.slice(0, character).match(/[\w$]+$/)
    const afterMatch = lineText.slice(character).match(/^[\w$]+/)

    if (!wordMatch && !afterMatch) return null

    const word = (wordMatch?.[0] || '') + (afterMatch?.[0] || '')

    // Find declaration for this word
    const decl = doc.declarations.find(d => d.name === word)
    if (!decl) return null

    return {
      uri: params.textDocument.uri,
      range: this.getDeclarationRange(decl, doc.content),
    }
  }

  /**
   * Generate .d.ts content for current document
   */
  generateDts(uri: string): string | null {
    const doc = this.documents.get(uri)
    if (!doc) return null

    const context = {
      filePath: this.uriToPath(uri),
      sourceCode: doc.content,
      declarations: doc.declarations,
      imports: new Map<string, Set<string>>(),
      exports: new Set<string>(),
      usedTypes: new Set<string>(),
    }

    return processDeclarations(doc.declarations, context, true, this.config.importOrder)
  }

  /**
   * Build signature string for a declaration
   */
  private buildSignature(decl: Declaration): string {
    switch (decl.kind) {
      case 'function': {
        const params = decl.parameters?.map((p) => {
          let s = ''
          if (p.rest) s += '...'
          s += p.name
          if (p.optional) s += '?'
          if (p.type) s += `: ${p.type}`
          return s
        }).join(', ') || ''
        const generics = decl.generics || ''
        const returnType = decl.returnType ? `: ${decl.returnType}` : ''
        return `function ${decl.name}${generics}(${params})${returnType}`
      }

      case 'variable':
        return `const ${decl.name}: ${decl.typeAnnotation || 'unknown'}`

      case 'interface':
        return `interface ${decl.name}${decl.generics || ''}${decl.extends ? ` extends ${decl.extends}` : ''}`

      case 'type':
        return `type ${decl.name}${decl.generics || ''} = ${decl.typeAnnotation || 'unknown'}`

      case 'class':
        return `class ${decl.name}${decl.generics || ''}${decl.extends ? ` extends ${decl.extends}` : ''}`

      case 'enum':
        return `enum ${decl.name}`

      default:
        return decl.name
    }
  }

  /**
   * Get range for a declaration in source code
   */
  private getDeclarationRange(decl: Declaration, content: string): Range {
    // Use start/end if available
    if (decl.start !== undefined && decl.end !== undefined) {
      return {
        start: this.offsetToPosition(decl.start, content),
        end: this.offsetToPosition(decl.end, content),
      }
    }

    // Otherwise, search for the declaration name
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const col = lines[i].indexOf(decl.name)
      if (col !== -1) {
        return {
          start: { line: i, character: col },
          end: { line: i, character: col + decl.name.length },
        }
      }
    }

    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    }
  }

  /**
   * Convert byte offset to position
   */
  private offsetToPosition(offset: number, content: string): Position {
    let line = 0
    let character = 0

    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') {
        line++
        character = 0
      }
      else {
        character++
      }
    }

    return { line, character }
  }

  /**
   * Convert URI to file path
   */
  private uriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
      return decodeURIComponent(uri.slice(7))
    }
    return uri
  }

  /**
   * Convert file path to URI
   */
  private pathToUri(path: string): string {
    return `file://${encodeURIComponent(path).replace(/%2F/g, '/')}`
  }

  /**
   * Handle incoming message
   */
  handleMessage(message: LSPMessage): LSPMessage | null {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.initialize(message.params as InitializeParams),
      }
    }

    if (message.method === 'initialized') {
      return null // Notification, no response
    }

    if (message.method === 'shutdown') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: null,
      }
    }

    if (message.method === 'exit') {
      process.exit(0)
    }

    if (message.method === 'textDocument/didOpen') {
      this.didOpen(message.params)
      return null
    }

    if (message.method === 'textDocument/didChange') {
      this.didChange(message.params)
      return null
    }

    if (message.method === 'textDocument/didClose') {
      this.didClose(message.params)
      return null
    }

    if (message.method === 'textDocument/hover') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.hover(message.params),
      }
    }

    if (message.method === 'textDocument/completion') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.completion(message.params),
      }
    }

    if (message.method === 'textDocument/definition') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.definition(message.params),
      }
    }

    if (message.method === 'textDocument/diagnostic') {
      const uri = message.params?.textDocument?.uri
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          kind: 'full',
          items: uri ? this.getDiagnostics(uri) : [],
        },
      }
    }

    // Unknown method
    if (message.id !== undefined) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`,
        },
      }
    }

    return null
  }
}

/**
 * Start LSP server on stdio
 */
export function startLSPServer(): void {
  const server = new DtsxLanguageServer()

  let buffer = ''

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk

    while (true) {
      // Parse headers
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const headers = buffer.slice(0, headerEnd)
      const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const contentStart = headerEnd + 4
      const contentEnd = contentStart + contentLength

      if (buffer.length < contentEnd) break

      const content = buffer.slice(contentStart, contentEnd)
      buffer = buffer.slice(contentEnd)

      try {
        const message = JSON.parse(content) as LSPMessage
        const response = server.handleMessage(message)

        if (response) {
          const responseStr = JSON.stringify(response)
          const responseBytes = Buffer.byteLength(responseStr, 'utf8')
          process.stdout.write(`Content-Length: ${responseBytes}\r\n\r\n${responseStr}`)
        }
      }
      catch (error) {
        console.error('Error parsing LSP message:', error)
      }
    }
  })
}

/**
 * Create a simple file watcher that emits diagnostics
 */
export function createFileWatcher(
  server: DtsxLanguageServer,
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void,
): (filePath: string) => void {
  return (filePath: string) => {
    if (!existsSync(filePath)) return

    const content = readFileSync(filePath, 'utf-8')
    const uri = `file://${filePath}`

    server.didOpen({
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 1,
        text: content,
      },
    })

    const diagnostics = server.getDiagnostics(uri)
    onDiagnostics(uri, diagnostics)
  }
}

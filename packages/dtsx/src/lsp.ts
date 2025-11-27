import type { watchFile } from 'node:fs'
import type { Declaration, DtsGenerationConfig } from './types'
import { existsSync, readFileSync, unwatchFile } from 'node:fs'
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
  referencesProvider?: boolean
  renameProvider?: boolean | { prepareProvider?: boolean }
  documentSymbolProvider?: boolean
  workspaceSymbolProvider?: boolean
  codeActionProvider?: boolean | { codeActionKinds?: string[] }
  signatureHelpProvider?: {
    triggerCharacters?: string[]
    retriggerCharacters?: string[]
  }
  documentHighlightProvider?: boolean
  documentFormattingProvider?: boolean
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
 * LSP Diagnostic severity (matches LSP specification)
 */
export enum LspDiagnosticSeverity {
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
  severity?: LspDiagnosticSeverity
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
 * Symbol kind enum (LSP spec)
 */
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

/**
 * Document symbol
 */
export interface DocumentSymbol {
  name: string
  detail?: string
  kind: SymbolKind
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}

/**
 * Workspace symbol
 */
export interface WorkspaceSymbol {
  name: string
  kind: SymbolKind
  location: Location
  containerName?: string
}

/**
 * Completion item kind enum
 */
export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

/**
 * Code action
 */
export interface CodeAction {
  title: string
  kind?: string
  diagnostics?: Diagnostic[]
  isPreferred?: boolean
  edit?: WorkspaceEdit
  command?: Command
}

/**
 * Workspace edit
 */
export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
}

/**
 * Text edit
 */
export interface TextEdit {
  range: Range
  newText: string
}

/**
 * Command
 */
export interface Command {
  title: string
  command: string
  arguments?: any[]
}

/**
 * Signature help
 */
export interface SignatureHelp {
  signatures: SignatureInformation[]
  activeSignature?: number
  activeParameter?: number
}

/**
 * Signature information
 */
export interface SignatureInformation {
  label: string
  documentation?: string | { kind: string, value: string }
  parameters?: ParameterInformation[]
}

/**
 * Parameter information
 */
export interface ParameterInformation {
  label: string | [number, number]
  documentation?: string | { kind: string, value: string }
}

/**
 * Document highlight
 */
export interface DocumentHighlight {
  range: Range
  kind?: DocumentHighlightKind
}

/**
 * Document highlight kind
 */
export enum DocumentHighlightKind {
  Text = 1,
  Read = 2,
  Write = 3,
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
          triggerCharacters: ['.', ':', '<', '"', '\'', '/'],
          resolveProvider: true,
        },
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: {
          prepareProvider: true,
        },
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: {
          codeActionKinds: ['quickfix', 'refactor', 'source'],
        },
        signatureHelpProvider: {
          triggerCharacters: ['(', ','],
          retriggerCharacters: [','],
        },
        documentHighlightProvider: true,
        documentFormattingProvider: true,
        diagnosticProvider: {
          interFileDependencies: true,
          workspaceDiagnostics: true,
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
    if (!doc)
      return []

    const diagnostics: Diagnostic[] = []

    // Check for common issues
    for (const decl of doc.declarations) {
      // Check for missing type annotations on exported values
      if (decl.isExported && decl.kind === 'variable' && !decl.typeAnnotation) {
        diagnostics.push({
          range: this.getDeclarationRange(decl, doc.content),
          severity: LspDiagnosticSeverity.Warning,
          code: 'missing-type',
          source: 'dtsx',
          message: `Exported variable '${decl.name}' should have an explicit type annotation for better declaration generation`,
        })
      }

      // Check for any types
      if (decl.typeAnnotation === 'any' || decl.returnType === 'any') {
        diagnostics.push({
          range: this.getDeclarationRange(decl, doc.content),
          severity: LspDiagnosticSeverity.Information,
          code: 'any-type',
          source: 'dtsx',
          message: `Consider using a more specific type instead of 'any'`,
        })
      }

      // Check for functions without return type
      if (decl.kind === 'function' && decl.isExported && !decl.returnType) {
        diagnostics.push({
          range: this.getDeclarationRange(decl, doc.content),
          severity: LspDiagnosticSeverity.Information,
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
    if (!doc)
      return null

    const { line, character } = params.position
    const lines = doc.content.split('\n')
    const lineText = lines[line] || ''

    // Find word at position
    const wordMatch = lineText.slice(0, character).match(/[\w$]+$/)
    const afterMatch = lineText.slice(character).match(/^[\w$]+/)

    if (!wordMatch && !afterMatch)
      return null

    const word = (wordMatch?.[0] || '') + (afterMatch?.[0] || '')

    // Find declaration for this word
    const decl = doc.declarations.find(d => d.name === word)
    if (!decl)
      return null

    // Generate hover content
    const signature = this.buildSignature(decl)
    let content = `\`\`\`typescript\n${signature}\n\`\`\``

    // Add JSDoc description if available
    if (decl.leadingComments && decl.leadingComments.length > 0) {
      const jsdoc = decl.leadingComments.join('\n')
      const descMatch = jsdoc.match(/\*\s*([^@*][^*]*)/)
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
    if (!doc)
      return []

    const items: Array<{ label: string, kind: number, detail?: string, documentation?: string }> = []

    // Add all exported declarations as completion items
    for (const decl of doc.declarations) {
      if (!decl.isExported)
        continue

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
    if (!doc)
      return null

    const { line, character } = params.position
    const lines = doc.content.split('\n')
    const lineText = lines[line] || ''

    // Find word at position
    const wordMatch = lineText.slice(0, character).match(/[\w$]+$/)
    const afterMatch = lineText.slice(character).match(/^[\w$]+/)

    if (!wordMatch && !afterMatch)
      return null

    const word = (wordMatch?.[0] || '') + (afterMatch?.[0] || '')

    // Find declaration for this word
    const decl = doc.declarations.find(d => d.name === word)
    if (!decl)
      return null

    return {
      uri: params.textDocument.uri,
      range: this.getDeclarationRange(decl, doc.content),
    }
  }

  /**
   * Handle find references request
   */
  references(params: { textDocument: { uri: string }, position: Position, context: { includeDeclaration: boolean } }): Location[] {
    const locations: Location[] = []
    const word = this.getWordAtPosition(params.textDocument.uri, params.position)
    if (!word)
      return locations

    // Search in all open documents
    for (const [uri, doc] of this.documents) {
      const lines = doc.content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        let col = 0

        while (col < line.length) {
          const idx = line.indexOf(word, col)
          if (idx === -1)
            break

          // Check it's a whole word
          const before = idx > 0 ? line[idx - 1] : ' '
          const after = idx + word.length < line.length ? line[idx + word.length] : ' '

          if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) {
            locations.push({
              uri,
              range: {
                start: { line: i, character: idx },
                end: { line: i, character: idx + word.length },
              },
            })
          }

          col = idx + 1
        }
      }
    }

    return locations
  }

  /**
   * Handle prepare rename request
   */
  prepareRename(params: { textDocument: { uri: string }, position: Position }): { range: Range, placeholder: string } | null {
    const word = this.getWordAtPosition(params.textDocument.uri, params.position)
    if (!word)
      return null

    const doc = this.documents.get(params.textDocument.uri)
    if (!doc)
      return null

    // Check if it's a declaration we can rename
    const decl = doc.declarations.find(d => d.name === word)
    if (!decl)
      return null

    const range = this.getDeclarationRange(decl, doc.content)
    return { range, placeholder: word }
  }

  /**
   * Handle rename request
   */
  rename(params: { textDocument: { uri: string }, position: Position, newName: string }): WorkspaceEdit | null {
    const word = this.getWordAtPosition(params.textDocument.uri, params.position)
    if (!word)
      return null

    const references = this.references({
      textDocument: params.textDocument,
      position: params.position,
      context: { includeDeclaration: true },
    })

    if (references.length === 0)
      return null

    const changes: Record<string, TextEdit[]> = {}

    for (const ref of references) {
      if (!changes[ref.uri]) {
        changes[ref.uri] = []
      }
      changes[ref.uri].push({
        range: ref.range,
        newText: params.newName,
      })
    }

    return { changes }
  }

  /**
   * Handle document symbols request
   */
  documentSymbols(params: { textDocument: { uri: string } }): DocumentSymbol[] {
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc)
      return []

    const symbols: DocumentSymbol[] = []

    for (const decl of doc.declarations) {
      const range = this.getDeclarationRange(decl, doc.content)
      const kind = this.declarationKindToSymbolKind(decl.kind)

      const symbol: DocumentSymbol = {
        name: decl.name,
        detail: this.buildSignature(decl),
        kind,
        range,
        selectionRange: range,
      }

      // Add children for interfaces/classes with members
      if (decl.members && decl.members.length > 0) {
        symbol.children = decl.members.map(member => ({
          name: member.name,
          kind: this.declarationKindToSymbolKind(member.kind),
          range: this.getDeclarationRange(member, doc.content),
          selectionRange: this.getDeclarationRange(member, doc.content),
        }))
      }

      symbols.push(symbol)
    }

    return symbols
  }

  /**
   * Handle workspace symbols request
   */
  workspaceSymbols(params: { query: string }): WorkspaceSymbol[] {
    const symbols: WorkspaceSymbol[] = []
    const query = params.query.toLowerCase()

    for (const [uri, doc] of this.documents) {
      for (const decl of doc.declarations) {
        if (!decl.isExported)
          continue
        if (query && !decl.name.toLowerCase().includes(query))
          continue

        symbols.push({
          name: decl.name,
          kind: this.declarationKindToSymbolKind(decl.kind),
          location: {
            uri,
            range: this.getDeclarationRange(decl, doc.content),
          },
        })
      }
    }

    return symbols
  }

  /**
   * Handle code actions request
   */
  codeActions(params: { textDocument: { uri: string }, range: Range, context: { diagnostics: Diagnostic[] } }): CodeAction[] {
    const actions: CodeAction[] = []
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc)
      return actions

    for (const diagnostic of params.context.diagnostics) {
      if (diagnostic.code === 'missing-type') {
        // Suggest adding type annotation
        const word = this.getWordAtRange(params.textDocument.uri, diagnostic.range)
        if (word) {
          actions.push({
            title: `Add type annotation to '${word}'`,
            kind: 'quickfix',
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [params.textDocument.uri]: [{
                  range: {
                    start: diagnostic.range.end,
                    end: diagnostic.range.end,
                  },
                  newText: ': unknown',
                }],
              },
            },
          })
        }
      }

      if (diagnostic.code === 'any-type') {
        // Suggest replacing any with unknown
        actions.push({
          title: 'Replace \'any\' with \'unknown\'',
          kind: 'quickfix',
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [params.textDocument.uri]: [{
                range: diagnostic.range,
                newText: 'unknown',
              }],
            },
          },
        })
      }

      if (diagnostic.code === 'missing-return-type') {
        const word = this.getWordAtRange(params.textDocument.uri, diagnostic.range)
        if (word) {
          actions.push({
            title: `Add return type to '${word}'`,
            kind: 'quickfix',
            diagnostics: [diagnostic],
          })
        }
      }
    }

    // Add refactoring actions
    const decl = this.getDeclarationAtPosition(params.textDocument.uri, params.range.start)
    if (decl) {
      if (decl.kind === 'function') {
        actions.push({
          title: 'Extract function signature to type',
          kind: 'refactor.extract',
        })
      }

      if (decl.kind === 'interface' || decl.kind === 'type') {
        actions.push({
          title: 'Generate runtime validator',
          kind: 'source',
        })
      }
    }

    return actions
  }

  /**
   * Handle signature help request
   */
  signatureHelp(params: { textDocument: { uri: string }, position: Position }): SignatureHelp | null {
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc)
      return null

    const { line, character } = params.position
    const lines = doc.content.split('\n')
    const lineText = lines[line] || ''

    // Find the function call context
    let parenDepth = 0
    let funcStart = -1
    let activeParam = 0

    for (let i = character - 1; i >= 0; i--) {
      const char = lineText[i]
      if (char === ')') {
        parenDepth++
      }
      else if (char === '(') {
        if (parenDepth === 0) {
          funcStart = i
          break
        }
        parenDepth--
      }
      else if (char === ',' && parenDepth === 0) {
        activeParam++
      }
    }

    if (funcStart === -1)
      return null

    // Find function name
    const beforeParen = lineText.slice(0, funcStart).trimEnd()
    const funcMatch = beforeParen.match(/[\w$]+$/)
    if (!funcMatch)
      return null

    const funcName = funcMatch[0]
    const decl = doc.declarations.find(d => d.name === funcName && d.kind === 'function')
    if (!decl || !decl.parameters)
      return null

    const params_list = decl.parameters.map((p) => {
      let s = ''
      if (p.rest)
        s += '...'
      s += p.name
      if (p.optional)
        s += '?'
      if (p.type)
        s += `: ${p.type}`
      return s
    })

    const signature = `${funcName}(${params_list.join(', ')}): ${decl.returnType || 'void'}`

    return {
      signatures: [{
        label: signature,
        parameters: decl.parameters.map(p => ({
          label: p.name,
          documentation: p.type ? `Type: ${p.type}` : undefined,
        })),
      }],
      activeSignature: 0,
      activeParameter: Math.min(activeParam, decl.parameters.length - 1),
    }
  }

  /**
   * Handle document highlight request
   */
  documentHighlight(params: { textDocument: { uri: string }, position: Position }): DocumentHighlight[] {
    const highlights: DocumentHighlight[] = []
    const word = this.getWordAtPosition(params.textDocument.uri, params.position)
    if (!word)
      return highlights

    const doc = this.documents.get(params.textDocument.uri)
    if (!doc)
      return highlights

    const lines = doc.content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      let col = 0

      while (col < line.length) {
        const idx = line.indexOf(word, col)
        if (idx === -1)
          break

        const before = idx > 0 ? line[idx - 1] : ' '
        const after = idx + word.length < line.length ? line[idx + word.length] : ' '

        if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) {
          // Determine if it's a write or read
          const isWrite = /^\s*[=:]/.test(line.slice(idx + word.length))
            || /^(const|let|var|function|class|interface|type|enum)\s+$/.test(line.slice(0, idx))

          highlights.push({
            range: {
              start: { line: i, character: idx },
              end: { line: i, character: idx + word.length },
            },
            kind: isWrite ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
          })
        }

        col = idx + 1
      }
    }

    return highlights
  }

  /**
   * Handle document formatting request
   */
  async formatting(params: { textDocument: { uri: string }, options: { tabSize: number, insertSpaces: boolean } }): Promise<TextEdit[]> {
    const doc = this.documents.get(params.textDocument.uri)
    if (!doc)
      return []

    // Generate formatted .d.ts
    const dts = this.generateDts(params.textDocument.uri)
    if (!dts)
      return []

    const lines = doc.content.split('\n')
    return [{
      range: {
        start: { line: 0, character: 0 },
        end: { line: lines.length - 1, character: lines[lines.length - 1].length },
      },
      newText: dts,
    }]
  }

  /**
   * Helper: Get word at position
   */
  private getWordAtPosition(uri: string, position: Position): string | null {
    const doc = this.documents.get(uri)
    if (!doc)
      return null

    const lines = doc.content.split('\n')
    const lineText = lines[position.line] || ''

    const wordMatch = lineText.slice(0, position.character).match(/[\w$]+$/)
    const afterMatch = lineText.slice(position.character).match(/^[\w$]+/)

    if (!wordMatch && !afterMatch)
      return null
    return (wordMatch?.[0] || '') + (afterMatch?.[0] || '')
  }

  /**
   * Helper: Get word at range
   */
  private getWordAtRange(uri: string, range: Range): string | null {
    const doc = this.documents.get(uri)
    if (!doc)
      return null

    const lines = doc.content.split('\n')
    if (range.start.line === range.end.line) {
      return lines[range.start.line]?.slice(range.start.character, range.end.character) || null
    }
    return null
  }

  /**
   * Helper: Get declaration at position
   */
  private getDeclarationAtPosition(uri: string, position: Position): Declaration | null {
    const doc = this.documents.get(uri)
    if (!doc)
      return null

    for (const decl of doc.declarations) {
      const range = this.getDeclarationRange(decl, doc.content)
      if (this.positionInRange(position, range)) {
        return decl
      }
    }
    return null
  }

  /**
   * Helper: Check if position is in range
   */
  private positionInRange(pos: Position, range: Range): boolean {
    if (pos.line < range.start.line || pos.line > range.end.line)
      return false
    if (pos.line === range.start.line && pos.character < range.start.character)
      return false
    if (pos.line === range.end.line && pos.character > range.end.character)
      return false
    return true
  }

  /**
   * Helper: Convert declaration kind to symbol kind
   */
  private declarationKindToSymbolKind(kind: string): SymbolKind {
    switch (kind) {
      case 'function': return SymbolKind.Function
      case 'class': return SymbolKind.Class
      case 'interface': return SymbolKind.Interface
      case 'type': return SymbolKind.Interface
      case 'enum': return SymbolKind.Enum
      case 'variable': return SymbolKind.Variable
      case 'const': return SymbolKind.Constant
      case 'property': return SymbolKind.Property
      case 'method': return SymbolKind.Method
      case 'module': return SymbolKind.Module
      case 'namespace': return SymbolKind.Namespace
      default: return SymbolKind.Variable
    }
  }

  /**
   * Generate .d.ts content for current document
   */
  generateDts(uri: string): string | null {
    const doc = this.documents.get(uri)
    if (!doc)
      return null

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
          if (p.rest)
            s += '...'
          s += p.name
          if (p.optional)
            s += '?'
          if (p.type)
            s += `: ${p.type}`
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

    if (message.method === 'textDocument/references') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.references(message.params),
      }
    }

    if (message.method === 'textDocument/prepareRename') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.prepareRename(message.params),
      }
    }

    if (message.method === 'textDocument/rename') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.rename(message.params),
      }
    }

    if (message.method === 'textDocument/documentSymbol') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.documentSymbols(message.params),
      }
    }

    if (message.method === 'workspace/symbol') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.workspaceSymbols(message.params),
      }
    }

    if (message.method === 'textDocument/codeAction') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.codeActions(message.params),
      }
    }

    if (message.method === 'textDocument/signatureHelp') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.signatureHelp(message.params),
      }
    }

    if (message.method === 'textDocument/documentHighlight') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.documentHighlight(message.params),
      }
    }

    if (message.method === 'textDocument/formatting') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.formatting(message.params),
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
      if (headerEnd === -1)
        break

      const headers = buffer.slice(0, headerEnd)
      const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = Number.parseInt(contentLengthMatch[1], 10)
      const contentStart = headerEnd + 4
      const contentEnd = contentStart + contentLength

      if (buffer.length < contentEnd)
        break

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
    if (!existsSync(filePath))
      return

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

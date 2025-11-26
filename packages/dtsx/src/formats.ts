import type { Declaration, DeclarationKind, ParameterDeclaration } from './types'

/**
 * Supported output formats
 */
export type OutputFormat = 'dts' | 'json-schema' | 'zod' | 'io-ts' | 'yup' | 'valibot' | 'arktype'

/**
 * Options for format conversion
 */
export interface FormatOptions {
  /** Output format */
  format: OutputFormat
  /** Add $schema to JSON Schema output */
  includeSchema?: boolean
  /** JSON Schema draft version */
  jsonSchemaDraft?: '2020-12' | '2019-09' | 'draft-07'
  /** Make all properties optional by default */
  allOptional?: boolean
  /** Include JSDoc descriptions */
  includeDescriptions?: boolean
  /** Indent size for output */
  indent?: number
  /** Export name for schema (used in Zod, etc.) */
  exportName?: string
  /** Use inferred types (Zod's z.infer) */
  useInfer?: boolean
}

/**
 * JSON Schema type representation
 */
interface JSONSchemaType {
  $schema?: string
  $id?: string
  title?: string
  description?: string
  type?: string | string[]
  properties?: Record<string, JSONSchemaType>
  required?: string[]
  items?: JSONSchemaType | JSONSchemaType[]
  additionalProperties?: boolean | JSONSchemaType
  enum?: any[]
  const?: any
  oneOf?: JSONSchemaType[]
  anyOf?: JSONSchemaType[]
  allOf?: JSONSchemaType[]
  $ref?: string
  definitions?: Record<string, JSONSchemaType>
  $defs?: Record<string, JSONSchemaType>
  format?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  default?: any
}

/**
 * Convert TypeScript type string to JSON Schema type
 */
function tsTypeToJsonSchema(tsType: string, definitions: Map<string, JSONSchemaType>): JSONSchemaType {
  const type = tsType.trim()

  // Primitives
  if (type === 'string') return { type: 'string' }
  if (type === 'number') return { type: 'number' }
  if (type === 'boolean') return { type: 'boolean' }
  if (type === 'null') return { type: 'null' }
  if (type === 'undefined') return { type: 'null' } // JSON doesn't have undefined
  if (type === 'any' || type === 'unknown') return {} // Any type
  if (type === 'never') return { not: {} }
  if (type === 'void') return { type: 'null' }
  if (type === 'bigint') return { type: 'integer' }
  if (type === 'symbol') return { type: 'string', description: 'Symbol type' }
  if (type === 'object') return { type: 'object' }

  // String literal
  if (type.startsWith('\'') || type.startsWith('"')) {
    return { const: type.slice(1, -1) }
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(type)) {
    return { const: Number.parseFloat(type) }
  }

  // Boolean literal
  if (type === 'true') return { const: true }
  if (type === 'false') return { const: false }

  // Array types
  const arrayMatch = type.match(/^(.+)\[\]$/) || type.match(/^Array<(.+)>$/i)
  if (arrayMatch) {
    return {
      type: 'array',
      items: tsTypeToJsonSchema(arrayMatch[1], definitions),
    }
  }

  // Tuple types
  const tupleMatch = type.match(/^\[(.+)\]$/)
  if (tupleMatch) {
    const items = splitTypeUnion(tupleMatch[1], ',').map(t => tsTypeToJsonSchema(t.trim(), definitions))
    return {
      type: 'array',
      items,
      minItems: items.length,
      maxItems: items.length,
    }
  }

  // Union types
  if (type.includes('|')) {
    const types = splitTypeUnion(type, '|')
    if (types.length > 1) {
      // Check for nullable
      const nonNullTypes = types.filter(t => t.trim() !== 'null' && t.trim() !== 'undefined')
      const hasNull = types.some(t => t.trim() === 'null' || t.trim() === 'undefined')

      if (hasNull && nonNullTypes.length === 1) {
        const schema = tsTypeToJsonSchema(nonNullTypes[0], definitions)
        if (schema.type && typeof schema.type === 'string') {
          return { ...schema, type: [schema.type, 'null'] }
        }
        return { oneOf: [schema, { type: 'null' }] }
      }

      return {
        oneOf: types.map(t => tsTypeToJsonSchema(t.trim(), definitions)),
      }
    }
  }

  // Intersection types (approximated as allOf)
  if (type.includes('&')) {
    const types = splitTypeUnion(type, '&')
    if (types.length > 1) {
      return {
        allOf: types.map(t => tsTypeToJsonSchema(t.trim(), definitions)),
      }
    }
  }

  // Record/Map types
  const recordMatch = type.match(/^Record<(.+),\s*(.+)>$/i)
  if (recordMatch) {
    return {
      type: 'object',
      additionalProperties: tsTypeToJsonSchema(recordMatch[2], definitions),
    }
  }

  // Promise (unwrap)
  const promiseMatch = type.match(/^Promise<(.+)>$/i)
  if (promiseMatch) {
    return tsTypeToJsonSchema(promiseMatch[1], definitions)
  }

  // Utility types
  const partialMatch = type.match(/^Partial<(.+)>$/i)
  if (partialMatch) {
    const inner = tsTypeToJsonSchema(partialMatch[1], definitions)
    return { ...inner, required: [] } // Make all optional
  }

  const requiredMatch = type.match(/^Required<(.+)>$/i)
  if (requiredMatch) {
    return tsTypeToJsonSchema(requiredMatch[1], definitions)
  }

  const readonlyMatch = type.match(/^Readonly<(.+)>$/i)
  if (readonlyMatch) {
    return tsTypeToJsonSchema(readonlyMatch[1], definitions)
  }

  const pickMatch = type.match(/^Pick<(.+),\s*(.+)>$/i)
  if (pickMatch) {
    // Just reference the base type for simplicity
    return tsTypeToJsonSchema(pickMatch[1], definitions)
  }

  const omitMatch = type.match(/^Omit<(.+),\s*(.+)>$/i)
  if (omitMatch) {
    return tsTypeToJsonSchema(omitMatch[1], definitions)
  }

  // Date
  if (type === 'Date') {
    return { type: 'string', format: 'date-time' }
  }

  // Reference to another type
  if (/^[A-Z]\w*$/.test(type)) {
    return { $ref: `#/$defs/${type}` }
  }

  // Default to object
  return { type: 'object' }
}

/**
 * Convert declarations to JSON Schema
 */
export function toJsonSchema(
  declarations: Declaration[],
  options: Partial<FormatOptions> = {},
): string {
  const indent = options.indent ?? 2
  const draft = options.jsonSchemaDraft ?? '2020-12'

  const schemaUrl = {
    '2020-12': 'https://json-schema.org/draft/2020-12/schema',
    '2019-09': 'https://json-schema.org/draft/2019-09/schema',
    'draft-07': 'http://json-schema.org/draft-07/schema#',
  }[draft]

  const definitions = new Map<string, JSONSchemaType>()
  const schema: JSONSchemaType = {
    $schema: options.includeSchema !== false ? schemaUrl : undefined,
    $defs: {},
  }

  // Process all declarations
  for (const decl of declarations) {
    if (decl.kind === 'interface' || decl.kind === 'type') {
      const typeSchema = declarationToJsonSchema(decl, definitions, options)
      if (schema.$defs) {
        schema.$defs[decl.name] = typeSchema
      }
    }
  }

  // If there's only one definition, make it the root
  if (schema.$defs && Object.keys(schema.$defs).length === 1) {
    const [name, def] = Object.entries(schema.$defs)[0]
    return JSON.stringify(
      {
        $schema: schema.$schema,
        title: name,
        ...def,
      },
      null,
      indent,
    )
  }

  return JSON.stringify(schema, null, indent)
}

/**
 * Convert a single declaration to JSON Schema
 */
function declarationToJsonSchema(
  decl: Declaration,
  definitions: Map<string, JSONSchemaType>,
  options: Partial<FormatOptions>,
): JSONSchemaType {
  const schema: JSONSchemaType = {
    type: 'object',
  }

  // Add description from JSDoc
  if (options.includeDescriptions && decl.leadingComments?.length) {
    const description = extractDescription(decl.leadingComments)
    if (description) {
      schema.description = description
    }
  }

  // Parse members for interfaces
  if (decl.members && decl.members.length > 0) {
    schema.properties = {}
    schema.required = []

    for (const member of decl.members) {
      if (member.name && member.typeAnnotation) {
        const propSchema = tsTypeToJsonSchema(member.typeAnnotation, definitions)

        // Add description from JSDoc
        if (options.includeDescriptions && member.leadingComments?.length) {
          const desc = extractDescription(member.leadingComments)
          if (desc) {
            propSchema.description = desc
          }
        }

        schema.properties[member.name] = propSchema

        // Check if required (not optional)
        const isOptional = member.modifiers?.includes('?') ||
          member.text?.includes('?:') ||
          options.allOptional
        if (!isOptional) {
          schema.required.push(member.name)
        }
      }
    }

    if (schema.required.length === 0) {
      delete schema.required
    }
  }
  // Parse type annotation for type aliases
  else if (decl.typeAnnotation) {
    return tsTypeToJsonSchema(decl.typeAnnotation, definitions)
  }

  return schema
}

/**
 * Convert declarations to Zod schema
 */
export function toZod(
  declarations: Declaration[],
  options: Partial<FormatOptions> = {},
): string {
  const lines: string[] = [
    'import { z } from \'zod\'',
    '',
  ]

  for (const decl of declarations) {
    if (decl.kind === 'interface' || decl.kind === 'type') {
      const schemaName = options.exportName || `${decl.name}Schema`
      const zodCode = declarationToZod(decl, options)

      lines.push(`export const ${schemaName} = ${zodCode}`)
      lines.push('')

      // Add inferred type
      if (options.useInfer !== false) {
        lines.push(`export type ${decl.name} = z.infer<typeof ${schemaName}>`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Convert a single declaration to Zod schema code
 */
function declarationToZod(
  decl: Declaration,
  options: Partial<FormatOptions>,
): string {
  if (decl.members && decl.members.length > 0) {
    const properties = decl.members
      .filter(m => m.name && m.typeAnnotation)
      .map((member) => {
        let zodType = tsTypeToZod(member.typeAnnotation!)
        const isOptional = member.modifiers?.includes('?') ||
          member.text?.includes('?:') ||
          options.allOptional

        if (isOptional) {
          zodType = `${zodType}.optional()`
        }

        // Add description
        if (options.includeDescriptions && member.leadingComments?.length) {
          const desc = extractDescription(member.leadingComments)
          if (desc) {
            zodType = `${zodType}.describe(${JSON.stringify(desc)})`
          }
        }

        return `  ${member.name}: ${zodType}`
      })
      .join(',\n')

    return `z.object({\n${properties}\n})`
  }

  if (decl.typeAnnotation) {
    return tsTypeToZod(decl.typeAnnotation)
  }

  return 'z.unknown()'
}

/**
 * Convert TypeScript type to Zod type
 */
function tsTypeToZod(tsType: string): string {
  const type = tsType.trim()

  // Primitives
  if (type === 'string') return 'z.string()'
  if (type === 'number') return 'z.number()'
  if (type === 'boolean') return 'z.boolean()'
  if (type === 'null') return 'z.null()'
  if (type === 'undefined') return 'z.undefined()'
  if (type === 'any') return 'z.any()'
  if (type === 'unknown') return 'z.unknown()'
  if (type === 'never') return 'z.never()'
  if (type === 'void') return 'z.void()'
  if (type === 'bigint') return 'z.bigint()'
  if (type === 'symbol') return 'z.symbol()'
  if (type === 'Date') return 'z.date()'

  // String literal
  if (type.startsWith('\'') || type.startsWith('"')) {
    return `z.literal(${type})`
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(type)) {
    return `z.literal(${type})`
  }

  // Boolean literal
  if (type === 'true' || type === 'false') {
    return `z.literal(${type})`
  }

  // Array types
  const arrayMatch = type.match(/^(.+)\[\]$/) || type.match(/^Array<(.+)>$/i)
  if (arrayMatch) {
    return `z.array(${tsTypeToZod(arrayMatch[1])})`
  }

  // Tuple types
  const tupleMatch = type.match(/^\[(.+)\]$/)
  if (tupleMatch) {
    const items = splitTypeUnion(tupleMatch[1], ',').map(t => tsTypeToZod(t.trim()))
    return `z.tuple([${items.join(', ')}])`
  }

  // Union types
  if (type.includes('|')) {
    const types = splitTypeUnion(type, '|')
    if (types.length > 1) {
      // Check for nullable
      const nonNullTypes = types.filter(t => t.trim() !== 'null' && t.trim() !== 'undefined')
      const hasNull = types.some(t => t.trim() === 'null')
      const hasUndefined = types.some(t => t.trim() === 'undefined')

      if ((hasNull || hasUndefined) && nonNullTypes.length === 1) {
        let schema = tsTypeToZod(nonNullTypes[0])
        if (hasNull) schema = `${schema}.nullable()`
        if (hasUndefined) schema = `${schema}.optional()`
        return schema
      }

      const schemas = types.map(t => tsTypeToZod(t.trim()))
      return `z.union([${schemas.join(', ')}])`
    }
  }

  // Intersection types
  if (type.includes('&')) {
    const types = splitTypeUnion(type, '&')
    if (types.length > 1) {
      const schemas = types.map(t => tsTypeToZod(t.trim()))
      return schemas.reduce((acc, s) => `${acc}.and(${s})`)
    }
  }

  // Record type
  const recordMatch = type.match(/^Record<(.+),\s*(.+)>$/i)
  if (recordMatch) {
    return `z.record(${tsTypeToZod(recordMatch[1])}, ${tsTypeToZod(recordMatch[2])})`
  }

  // Promise
  const promiseMatch = type.match(/^Promise<(.+)>$/i)
  if (promiseMatch) {
    return `z.promise(${tsTypeToZod(promiseMatch[1])})`
  }

  // Map
  const mapMatch = type.match(/^Map<(.+),\s*(.+)>$/i)
  if (mapMatch) {
    return `z.map(${tsTypeToZod(mapMatch[1])}, ${tsTypeToZod(mapMatch[2])})`
  }

  // Set
  const setMatch = type.match(/^Set<(.+)>$/i)
  if (setMatch) {
    return `z.set(${tsTypeToZod(setMatch[1])})`
  }

  // Utility types
  const partialMatch = type.match(/^Partial<(.+)>$/i)
  if (partialMatch) {
    return `${tsTypeToZod(partialMatch[1])}.partial()`
  }

  const requiredMatch = type.match(/^Required<(.+)>$/i)
  if (requiredMatch) {
    return `${tsTypeToZod(requiredMatch[1])}.required()`
  }

  // Reference to another schema
  if (/^[A-Z]\w*$/.test(type)) {
    return `${type}Schema`
  }

  return 'z.unknown()'
}

/**
 * Convert declarations to Valibot schema
 */
export function toValibot(
  declarations: Declaration[],
  options: Partial<FormatOptions> = {},
): string {
  const lines: string[] = [
    'import * as v from \'valibot\'',
    '',
  ]

  for (const decl of declarations) {
    if (decl.kind === 'interface' || decl.kind === 'type') {
      const schemaName = options.exportName || `${decl.name}Schema`
      const valibotCode = declarationToValibot(decl, options)

      lines.push(`export const ${schemaName} = ${valibotCode}`)
      lines.push('')

      if (options.useInfer !== false) {
        lines.push(`export type ${decl.name} = v.InferOutput<typeof ${schemaName}>`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Convert a declaration to Valibot schema
 */
function declarationToValibot(
  decl: Declaration,
  options: Partial<FormatOptions>,
): string {
  if (decl.members && decl.members.length > 0) {
    const properties = decl.members
      .filter(m => m.name && m.typeAnnotation)
      .map((member) => {
        let valibotType = tsTypeToValibot(member.typeAnnotation!)
        const isOptional = member.modifiers?.includes('?') ||
          member.text?.includes('?:') ||
          options.allOptional

        if (isOptional) {
          valibotType = `v.optional(${valibotType})`
        }

        return `  ${member.name}: ${valibotType}`
      })
      .join(',\n')

    return `v.object({\n${properties}\n})`
  }

  if (decl.typeAnnotation) {
    return tsTypeToValibot(decl.typeAnnotation)
  }

  return 'v.unknown()'
}

/**
 * Convert TypeScript type to Valibot
 */
function tsTypeToValibot(tsType: string): string {
  const type = tsType.trim()

  if (type === 'string') return 'v.string()'
  if (type === 'number') return 'v.number()'
  if (type === 'boolean') return 'v.boolean()'
  if (type === 'null') return 'v.null_()'
  if (type === 'undefined') return 'v.undefined_()'
  if (type === 'any') return 'v.any()'
  if (type === 'unknown') return 'v.unknown()'
  if (type === 'never') return 'v.never()'
  if (type === 'void') return 'v.void_()'
  if (type === 'bigint') return 'v.bigint()'
  if (type === 'symbol') return 'v.symbol()'
  if (type === 'Date') return 'v.date()'

  // Literals
  if (type.startsWith('\'') || type.startsWith('"')) {
    return `v.literal(${type})`
  }
  if (/^-?\d+(\.\d+)?$/.test(type)) {
    return `v.literal(${type})`
  }
  if (type === 'true' || type === 'false') {
    return `v.literal(${type})`
  }

  // Array
  const arrayMatch = type.match(/^(.+)\[\]$/) || type.match(/^Array<(.+)>$/i)
  if (arrayMatch) {
    return `v.array(${tsTypeToValibot(arrayMatch[1])})`
  }

  // Tuple
  const tupleMatch = type.match(/^\[(.+)\]$/)
  if (tupleMatch) {
    const items = splitTypeUnion(tupleMatch[1], ',').map(t => tsTypeToValibot(t.trim()))
    return `v.tuple([${items.join(', ')}])`
  }

  // Union
  if (type.includes('|')) {
    const types = splitTypeUnion(type, '|')
    if (types.length > 1) {
      const nonNullTypes = types.filter(t => t.trim() !== 'null' && t.trim() !== 'undefined')
      const hasNull = types.some(t => t.trim() === 'null')
      const hasUndefined = types.some(t => t.trim() === 'undefined')

      if ((hasNull || hasUndefined) && nonNullTypes.length === 1) {
        let schema = tsTypeToValibot(nonNullTypes[0])
        if (hasNull) schema = `v.nullable(${schema})`
        if (hasUndefined) schema = `v.optional(${schema})`
        return schema
      }

      return `v.union([${types.map(t => tsTypeToValibot(t.trim())).join(', ')}])`
    }
  }

  // Intersection
  if (type.includes('&')) {
    const types = splitTypeUnion(type, '&')
    if (types.length > 1) {
      return `v.intersect([${types.map(t => tsTypeToValibot(t.trim())).join(', ')}])`
    }
  }

  // Record
  const recordMatch = type.match(/^Record<(.+),\s*(.+)>$/i)
  if (recordMatch) {
    return `v.record(${tsTypeToValibot(recordMatch[1])}, ${tsTypeToValibot(recordMatch[2])})`
  }

  // Reference
  if (/^[A-Z]\w*$/.test(type)) {
    return `${type}Schema`
  }

  return 'v.unknown()'
}

/**
 * Convert declarations to io-ts codec
 */
export function toIoTs(
  declarations: Declaration[],
  options: Partial<FormatOptions> = {},
): string {
  const lines: string[] = [
    'import * as t from \'io-ts\'',
    '',
  ]

  for (const decl of declarations) {
    if (decl.kind === 'interface' || decl.kind === 'type') {
      const codecName = options.exportName || `${decl.name}Codec`
      const ioTsCode = declarationToIoTs(decl, options)

      lines.push(`export const ${codecName} = ${ioTsCode}`)
      lines.push('')

      if (options.useInfer !== false) {
        lines.push(`export type ${decl.name} = t.TypeOf<typeof ${codecName}>`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Convert a declaration to io-ts
 */
function declarationToIoTs(
  decl: Declaration,
  options: Partial<FormatOptions>,
): string {
  if (decl.members && decl.members.length > 0) {
    const required: string[] = []
    const optional: string[] = []

    for (const member of decl.members) {
      if (!member.name || !member.typeAnnotation) continue

      const ioTsType = tsTypeToIoTs(member.typeAnnotation)
      const isOptional = member.modifiers?.includes('?') ||
        member.text?.includes('?:') ||
        options.allOptional

      const prop = `  ${member.name}: ${ioTsType}`
      if (isOptional) {
        optional.push(prop)
      }
      else {
        required.push(prop)
      }
    }

    if (optional.length > 0) {
      return `t.intersection([
  t.type({
${required.join(',\n')}
  }),
  t.partial({
${optional.join(',\n')}
  })
])`
    }

    return `t.type({
${required.join(',\n')}
})`
  }

  if (decl.typeAnnotation) {
    return tsTypeToIoTs(decl.typeAnnotation)
  }

  return 't.unknown'
}

/**
 * Convert TypeScript type to io-ts
 */
function tsTypeToIoTs(tsType: string): string {
  const type = tsType.trim()

  if (type === 'string') return 't.string'
  if (type === 'number') return 't.number'
  if (type === 'boolean') return 't.boolean'
  if (type === 'null') return 't.null'
  if (type === 'undefined') return 't.undefined'
  if (type === 'any') return 't.unknown'
  if (type === 'unknown') return 't.unknown'
  if (type === 'never') return 't.never'
  if (type === 'void') return 't.void'

  // Literals
  if (type.startsWith('\'') || type.startsWith('"')) {
    return `t.literal(${type})`
  }
  if (/^-?\d+(\.\d+)?$/.test(type)) {
    return `t.literal(${type})`
  }
  if (type === 'true' || type === 'false') {
    return `t.literal(${type})`
  }

  // Array
  const arrayMatch = type.match(/^(.+)\[\]$/) || type.match(/^Array<(.+)>$/i)
  if (arrayMatch) {
    return `t.array(${tsTypeToIoTs(arrayMatch[1])})`
  }

  // Tuple
  const tupleMatch = type.match(/^\[(.+)\]$/)
  if (tupleMatch) {
    const items = splitTypeUnion(tupleMatch[1], ',').map(t => tsTypeToIoTs(t.trim()))
    return `t.tuple([${items.join(', ')}])`
  }

  // Union
  if (type.includes('|')) {
    const types = splitTypeUnion(type, '|')
    if (types.length > 1) {
      return `t.union([${types.map(t => tsTypeToIoTs(t.trim())).join(', ')}])`
    }
  }

  // Intersection
  if (type.includes('&')) {
    const types = splitTypeUnion(type, '&')
    if (types.length > 1) {
      return `t.intersection([${types.map(t => tsTypeToIoTs(t.trim())).join(', ')}])`
    }
  }

  // Record
  const recordMatch = type.match(/^Record<(.+),\s*(.+)>$/i)
  if (recordMatch) {
    return `t.record(${tsTypeToIoTs(recordMatch[1])}, ${tsTypeToIoTs(recordMatch[2])})`
  }

  // Reference
  if (/^[A-Z]\w*$/.test(type)) {
    return `${type}Codec`
  }

  return 't.unknown'
}

/**
 * Convert declarations to Yup schema
 */
export function toYup(
  declarations: Declaration[],
  options: Partial<FormatOptions> = {},
): string {
  const lines: string[] = [
    'import * as yup from \'yup\'',
    '',
  ]

  for (const decl of declarations) {
    if (decl.kind === 'interface' || decl.kind === 'type') {
      const schemaName = options.exportName || `${decl.name}Schema`
      const yupCode = declarationToYup(decl, options)

      lines.push(`export const ${schemaName} = ${yupCode}`)
      lines.push('')

      if (options.useInfer !== false) {
        lines.push(`export type ${decl.name} = yup.InferType<typeof ${schemaName}>`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Convert a declaration to Yup schema
 */
function declarationToYup(
  decl: Declaration,
  options: Partial<FormatOptions>,
): string {
  if (decl.members && decl.members.length > 0) {
    const properties = decl.members
      .filter(m => m.name && m.typeAnnotation)
      .map((member) => {
        let yupType = tsTypeToYup(member.typeAnnotation!)
        const isOptional = member.modifiers?.includes('?') ||
          member.text?.includes('?:') ||
          options.allOptional

        if (!isOptional) {
          yupType = `${yupType}.required()`
        }

        return `  ${member.name}: ${yupType}`
      })
      .join(',\n')

    return `yup.object({\n${properties}\n})`
  }

  if (decl.typeAnnotation) {
    return tsTypeToYup(decl.typeAnnotation)
  }

  return 'yup.mixed()'
}

/**
 * Convert TypeScript type to Yup
 */
function tsTypeToYup(tsType: string): string {
  const type = tsType.trim()

  if (type === 'string') return 'yup.string()'
  if (type === 'number') return 'yup.number()'
  if (type === 'boolean') return 'yup.boolean()'
  if (type === 'Date') return 'yup.date()'
  if (type === 'any' || type === 'unknown') return 'yup.mixed()'

  // Array
  const arrayMatch = type.match(/^(.+)\[\]$/) || type.match(/^Array<(.+)>$/i)
  if (arrayMatch) {
    return `yup.array().of(${tsTypeToYup(arrayMatch[1])})`
  }

  // Union (handle nullable)
  if (type.includes('|')) {
    const types = splitTypeUnion(type, '|')
    if (types.length > 1) {
      const nonNullTypes = types.filter(t => t.trim() !== 'null' && t.trim() !== 'undefined')
      const hasNull = types.some(t => t.trim() === 'null' || t.trim() === 'undefined')

      if (hasNull && nonNullTypes.length === 1) {
        return `${tsTypeToYup(nonNullTypes[0])}.nullable()`
      }
    }
  }

  // Reference
  if (/^[A-Z]\w*$/.test(type)) {
    return `${type}Schema`
  }

  return 'yup.mixed()'
}

/**
 * Convert declarations to ArkType schema
 */
export function toArkType(
  declarations: Declaration[],
  options: Partial<FormatOptions> = {},
): string {
  const lines: string[] = [
    'import { type } from \'arktype\'',
    '',
  ]

  for (const decl of declarations) {
    if (decl.kind === 'interface' || decl.kind === 'type') {
      const schemaName = options.exportName || decl.name
      const arkCode = declarationToArkType(decl, options)

      lines.push(`export const ${schemaName} = ${arkCode}`)
      lines.push('')

      if (options.useInfer !== false) {
        lines.push(`export type ${decl.name}Type = typeof ${schemaName}.infer`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Convert a declaration to ArkType
 */
function declarationToArkType(
  decl: Declaration,
  options: Partial<FormatOptions>,
): string {
  if (decl.members && decl.members.length > 0) {
    const properties = decl.members
      .filter(m => m.name && m.typeAnnotation)
      .map((member) => {
        const arkType = tsTypeToArkType(member.typeAnnotation!)
        const isOptional = member.modifiers?.includes('?') ||
          member.text?.includes('?:') ||
          options.allOptional

        const key = isOptional ? `'${member.name}?'` : `${member.name}`
        return `  ${key}: ${arkType}`
      })
      .join(',\n')

    return `type({\n${properties}\n})`
  }

  if (decl.typeAnnotation) {
    return `type(${tsTypeToArkType(decl.typeAnnotation)})`
  }

  return 'type(\'unknown\')'
}

/**
 * Convert TypeScript type to ArkType string
 */
function tsTypeToArkType(tsType: string): string {
  const type = tsType.trim()

  // Primitives - ArkType uses string syntax
  if (type === 'string') return '\'string\''
  if (type === 'number') return '\'number\''
  if (type === 'boolean') return '\'boolean\''
  if (type === 'null') return '\'null\''
  if (type === 'undefined') return '\'undefined\''
  if (type === 'bigint') return '\'bigint\''
  if (type === 'symbol') return '\'symbol\''
  if (type === 'Date') return '\'Date\''
  if (type === 'any' || type === 'unknown') return '\'unknown\''

  // Array
  const arrayMatch = type.match(/^(.+)\[\]$/) || type.match(/^Array<(.+)>$/i)
  if (arrayMatch) {
    return `${tsTypeToArkType(arrayMatch[1])}.array()`
  }

  // Union
  if (type.includes('|')) {
    const types = splitTypeUnion(type, '|')
    if (types.length > 1) {
      return `'${types.map(t => t.trim()).join(' | ')}'`
    }
  }

  // Literals
  if (type.startsWith('\'') || type.startsWith('"')) {
    return `'${type}'`
  }

  return `'${type}'`
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Split a type string by delimiter, respecting nested angle brackets
 */
function splitTypeUnion(typeStr: string, delimiter: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (let i = 0; i < typeStr.length; i++) {
    const char = typeStr[i]

    if (char === '<' || char === '(' || char === '[' || char === '{') {
      depth++
      current += char
    }
    else if (char === '>' || char === ')' || char === ']' || char === '}') {
      depth--
      current += char
    }
    else if (depth === 0 && typeStr.slice(i, i + delimiter.length) === delimiter) {
      parts.push(current.trim())
      current = ''
      i += delimiter.length - 1
    }
    else {
      current += char
    }
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return parts
}

/**
 * Extract description from JSDoc comments
 */
function extractDescription(comments: string[]): string | null {
  for (const comment of comments) {
    // Remove comment delimiters and @tags
    const cleaned = comment
      .replace(/^\/\*\*|\*\/$/g, '')
      .replace(/^\s*\*\s?/gm, '')
      .replace(/@\w+.*/g, '')
      .trim()

    if (cleaned) {
      return cleaned
    }
  }
  return null
}

/**
 * Convert declarations to the specified format
 */
export function convertToFormat(
  declarations: Declaration[],
  options: FormatOptions,
): string {
  switch (options.format) {
    case 'json-schema':
      return toJsonSchema(declarations, options)
    case 'zod':
      return toZod(declarations, options)
    case 'valibot':
      return toValibot(declarations, options)
    case 'io-ts':
      return toIoTs(declarations, options)
    case 'yup':
      return toYup(declarations, options)
    case 'arktype':
      return toArkType(declarations, options)
    case 'dts':
    default:
      // For dts, just return declarations as-is (handled elsewhere)
      return declarations.map(d => d.text).join('\n\n')
  }
}

/**
 * Get file extension for output format
 */
export function getFormatExtension(format: OutputFormat): string {
  switch (format) {
    case 'json-schema':
      return '.schema.json'
    case 'zod':
    case 'valibot':
    case 'io-ts':
    case 'yup':
    case 'arktype':
      return '.schema.ts'
    case 'dts':
    default:
      return '.d.ts'
  }
}

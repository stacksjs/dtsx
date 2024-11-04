/**
 * Example of interface declaration
 * with another comment in an extra line
 */
export interface User {
  id: number
  name: string
  email: string
}

export interface ApiResponse<T> {
  status: number
  message: string
  data: T
}

/**
 * Example of an interface declaration
 *
 * with multiple lines of comments, including an empty line
 */
export interface ResponseData {
  success: boolean
  data: User[]
}

export interface Product {
  id: number
  name: string
  price: number
}

export interface AuthResponse {
  token: string
  expiresIn: number
}

interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}

// Complex Generic Types
export interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T
  key: K
  value: T[K]
  transform: (input: T[K]) => string
  nested: Array<Partial<T>>
}

// Default Type Parameters
export interface DefaultGeneric<
  T = string,
  K extends keyof any = string,
  V extends Record<K, T> = Record<K, T>
> {
  key: K
  value: T
  record: V
}

/**
 * Regular expression patterns used throughout the module
 */
// interface RegexPatterns {
//   /** Import type declarations */
//   readonly typeImport: RegExp
//   /** Regular import declarations */
//   readonly regularImport: RegExp
//   /** Async function declarations */
//   readonly asyncFunction: RegExp
//   /** Generic type parameters */
//   readonly functionOverload: RegExp
//   /** Module declaration pattern */
//   readonly moduleDeclaration: RegExp
//   /**
//    * Module augmentation pattern
//    */
//   readonly moduleAugmentation: RegExp
// }

// export interface ImportTrackingState {
//   typeImports: Map<string, Set<string>>
//   valueImports: Map<string, Set<string>>
//   usedTypes: Set<string>
//   usedValues: Set<string>
// }

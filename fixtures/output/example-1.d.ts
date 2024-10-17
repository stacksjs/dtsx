/**
 * Example of const declaration
 */
export declare const config: { [key: string]: string }

/**
 * Example of interface declaration
 */
export interface User {
  id: number
  name: string
  email: string
}

/**
 * Example of type declaration
 */
export interface ResponseData {
  success: boolean
  data: User[]
}

/**
 * Example of function declaration
 */
export declare function fetchUsers(): Promise<ResponseData>

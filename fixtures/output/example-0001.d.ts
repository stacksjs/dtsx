/**
 * Example of const declaration
 */
export declare const config: {
  apiUrl: 'https://api.example.com',
  timeout: '5000'
}
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

export declare interface User {
  id: number
  name: string
  email: string
}
export declare interface ApiResponse<T> {
  status: number
  message: string
  data: T
}
export declare interface ResponseData {
  success: boolean
  data: User[]
}
export declare interface Product {
  id: number
  name: string
  price: number
}
export declare interface AuthResponse {
  token: string
  expiresIn: number
}
declare interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}
export declare interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T
  key: K
  value: T[K]
  transform: (input: T[K]) => string
  nested: Array<Partial<T>>
}
export declare interface DefaultGeneric<
  T = string,
  K extends keyof any = string,
  V extends Record<K, T> = Record<K, T>
> {
  key: K
  value: T
  record: V
}
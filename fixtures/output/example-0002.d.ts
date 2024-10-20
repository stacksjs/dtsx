/**
 * Example of another const declaration
 */
export declare const settings: {
  theme: 'dark',
  language: 'en',
}

export interface Product {
  id: number
  name: string
  price: number
}

export interface ApiResponse<T> {
  status: number
  message: string
  data: T
}

/**
 * Example of function declaration
 */
export declare function getProduct(id: number): Promise<ApiResponse<Product>>

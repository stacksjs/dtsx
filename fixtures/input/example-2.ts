/**
 * Example of another const declaration
 */
export const settings: { [key: string]: any } = {
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
export function getProduct(id: number): Promise<ApiResponse<Product>> {
  return fetch(`${settings.apiUrl}/products/${id}`)
    .then(response => response.json()) as Promise<ApiResponse<Product>>
}

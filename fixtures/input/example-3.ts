/**
 * Example of const declaration
 */
export const endpoints = {
  getUsers: '/users',
  getProducts: '/products',
}

/**
 * Example of interface declaration
 */
export interface Order {
  orderId: number
  userId: number
  productIds: number[]
}

/**
 * Example of type declaration
 */
export interface OrderResponse {
  success: boolean
  order: Order
}

/**
 * Example of function declaration
 */
export async function createOrder(order: Order): Promise<OrderResponse> {
  return fetch(endpoints.getProducts, {
    method: 'POST',
    body: JSON.stringify(order),
  }).then(response => response.json()) as Promise<OrderResponse>
}

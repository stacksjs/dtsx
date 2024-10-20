export const endpoints = {
  getUsers: '/users',
  getProducts: '/products',
}

export interface Order {
  orderId: number
  userId: number
  productIds: number[]
}

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

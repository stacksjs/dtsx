export declare const endpoints: {
  getUsers: '/users'
  getProducts: '/products'
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
export declare function createOrder(order: Order): Promise<OrderResponse>

export declare const config: { [key: string]: string };
export interface User {
  id: number;
  name: string;
  email: string;
}
export type ResponseData = {
  success: boolean;
  data: User[];
};
export declare function fetchUsers(): Promise<ResponseData>;

export declare const settings: { [key: string]: any };
export interface Product {
  id: number;
  name: string;
  price: number;
}
export type ApiResponse<T> = {
  status: number;
  message: string;
  data: T;
};
export declare function getProduct(id: number): Promise<ApiResponse<Product>>;

export declare const endpoints: {
  getUsers: string;
  getProducts: string;
};
export interface Order {
  orderId: number;
  userId: number;
  productIds: number[];
}
export type OrderResponse = {
  success: boolean;
  order: Order;
};
export declare function createOrder(order: Order): Promise<OrderResponse>;

export declare const apiKeys: {
  google: string;
  facebook: string;
};
export interface AuthResponse {
  token: string;
  expiresIn: number;
}
export type AuthStatus = "authenticated" | "unauthenticated";
export declare function authenticate(user: string, password: string): Promise<AuthResponse>;

export declare const defaultHeaders: {
  "Content-Type": string;
};
export interface Comment {
  id: number;
  postId: number;
  body: string;
}
export type CommentsResponse = {
  comments: Comment[];
};
export declare function fetchComments(postId: number): Promise<CommentsResponse>;

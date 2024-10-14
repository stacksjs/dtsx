/**
 * Example of const declaration
 */
export const config: { [key: string]: string } = {
  apiUrl: "https://api.example.com",
  timeout: "5000",
};

/**
 * Example of interface declaration
 */
export interface User {
  id: number;
  name: string;
  email: string;
}

/**
 * Example of type declaration
 */
export type ResponseData = {
  success: boolean;
  data: User[];
};

/**
 * Example of function declaration
 */
export function fetchUsers(): Promise<ResponseData> {
  return fetch(config.apiUrl)
    .then(response => response.json()) as Promise<ResponseData>;
}

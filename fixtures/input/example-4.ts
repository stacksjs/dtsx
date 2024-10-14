/**
 * Example of const declaration
 */
export const apiKeys = {
  google: 'GOOGLE_API_KEY',
  facebook: 'FACEBOOK_API_KEY',
}

/**
 * Example of interface declaration
 */
export interface AuthResponse {
  token: string
  expiresIn: number
}

/**
 * Example of type declaration
 */
export type AuthStatus = 'authenticated' | 'unauthenticated'

/**
 * Example of function declaration
 */
export function authenticate(user: string, password: string): Promise<AuthResponse> {
  return fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user, password }),
  }).then(response => response.json()) as Promise<AuthResponse>
}

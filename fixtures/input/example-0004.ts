export const apiKeys = {
  google: 'GOOGLE_API_KEY',
  facebook: 'FACEBOOK_API_KEY',
}

export interface AuthResponse {
  token: string
  expiresIn: number
}

export type AuthStatus = 'authenticated' | 'unauthenticated'

export function authenticate(user: string, password: string): Promise<AuthResponse> {
  return fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user, password }),
  }).then(response => response.json()) as Promise<AuthResponse>
}

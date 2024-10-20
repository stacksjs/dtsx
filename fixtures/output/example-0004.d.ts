export declare const apiKeys: {
  google: 'GOOGLE_API_KEY',
  facebook: 'FACEBOOK_API_KEY',
}

export interface AuthResponse {
  token: string
  expiresIn: number
}

export type AuthStatus = 'authenticated' | 'unauthenticated'

export declare function authenticate(user: string, password: string): Promise<AuthResponse>

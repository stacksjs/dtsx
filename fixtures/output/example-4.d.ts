export declare const apiKeys

export interface AuthResponse  {
  token: string
  expiresIn: number
}

export type AuthStatus = 'authenticated' | 'unauthenticated'

export declare function authenticate(user: string, password: string): Promise<AuthResponse>

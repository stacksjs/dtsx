import { generate } from '../src/generator'
import { readFile, rm, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

async function testComplete() {
  console.log('Testing complete DTS generation...\n')

  const testDir = resolve(import.meta.dir, 'temp-complete')
  const inputDir = resolve(testDir, 'src')
  const outputDir = resolve(testDir, 'dist')

  // Clean up any existing test directories
  await rm(testDir, { recursive: true, force: true })
  await mkdir(inputDir, { recursive: true })

  // Create a comprehensive test file
  const testCode = `
import type { Config } from './config'
import { writeFile } from 'node:fs/promises'

// Type alias
export type ID = string | number

// Interface
export interface User {
  id: ID
  name: string
  email: string
  isActive: boolean
}

// Generic interface
export interface ApiResponse<T> {
  data: T
  status: number
  message?: string
}

// Class
export class UserService {
  private users: Map<ID, User> = new Map()

  constructor(private config: Config) {}

  async getUser(id: ID): Promise<User | undefined> {
    return this.users.get(id)
  }

  async createUser(user: User): Promise<User> {
    this.users.set(user.id, user)
    return user
  }
}

// Abstract class
export abstract class BaseService {
  abstract getName(): string

  log(message: string): void {
    console.log(\`[\${this.getName()}] \${message}\`)
  }
}

// Enum
export enum UserRole {
  Admin = 'ADMIN',
  User = 'USER',
  Guest = 'GUEST'
}

// Const enum
export const enum StatusCode {
  OK = 200,
  NotFound = 404,
  ServerError = 500
}

// Functions
export function formatUser(user: User): string {
  return \`\${user.name} <\${user.email}>\`
}

export async function saveUser(user: User): Promise<void> {
  await writeFile('user.json', JSON.stringify(user))
}

// Function overloads
export function getValue(key: string): string
export function getValue(key: string, defaultValue: string): string
export function getValue(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || ''
}

// Variables
export const VERSION = '1.0.0'
export const API_URL = 'https://api.example.com'

export const CONFIG = {
  api: {
    url: API_URL,
    timeout: 5000,
    retries: 3
  },
  features: {
    auth: true,
    logging: false
  }
} as const

// Complex type
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T

// Type with conditional
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E }

// Re-exports
export type { Config } from './config'
`

  await Bun.write(resolve(inputDir, 'index.ts'), testCode)

  // Run the generator
  await generate({
    cwd: testDir,
    root: './src',
    entrypoints: ['**/*.ts'],
    outdir: './dist',
    outputStructure: 'mirror',
    verbose: true
  })

  // Read and display the generated file
  const generatedContent = await readFile(resolve(outputDir, 'index.d.ts'), 'utf-8')
  console.log('\nGenerated index.d.ts:')
  console.log('=' .repeat(80))
  console.log(generatedContent)
  console.log('=' .repeat(80))

  // Clean up
  await rm(testDir, { recursive: true, force: true })
}

testComplete().catch(console.error)
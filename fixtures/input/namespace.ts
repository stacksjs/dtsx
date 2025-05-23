// Namespace declarations
export namespace Utils {
  export function formatDate(date: Date): string {
    return date.toISOString()
  }

  export interface Options {
    locale: string
    timezone: string
  }

  export const VERSION = '1.0.0'

  export namespace Validators {
    export function isEmail(value: string): boolean {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    }

    export function isURL(value: string): boolean {
      try {
        new URL(value)
        return true
      } catch {
        return false
      }
    }
  }
}

// Module declaration
declare module 'custom-module' {
  export interface CustomType {
    id: string
    data: any
  }

  export function process(input: CustomType): Promise<CustomType>
}

// Module augmentation
declare module 'existing-module' {
  interface ExistingInterface {
    newProperty: string
    newMethod(): void
  }

  export function newFunction(): void
}

// Global augmentation
declare global {
  interface Window {
    customProperty: string
    customMethod(): void
  }

  namespace NodeJS {
    interface ProcessEnv {
      CUSTOM_ENV_VAR: string
    }
  }
}

// Ambient module
declare module '*.css' {
  const content: { [className: string]: string }
  export default content
}

declare module '*.svg' {
  const content: string
  export default content
}

// Namespace with type exports
export namespace Types {
  export type ID = string | number
  export type Nullable<T> = T | null
  export type Optional<T> = T | undefined

  export interface User {
    id: ID
    name: string
    email: string
  }

  export enum Status {
    Active = 'ACTIVE',
    Inactive = 'INACTIVE',
    Pending = 'PENDING'
  }
}
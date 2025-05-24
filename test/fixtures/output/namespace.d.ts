export declare namespace Utils {
  export function formatDate(date: Date): string;
  export interface Options {
  locale: string
  timezone: string
}
  export const VERSION: string;
  export namespace Validators {
  export function isEmail(value: string): boolean;
  export function isURL(value: string): boolean;
}
}
declare module 'custom-module' {
  export interface CustomType {
  id: string
  data: any
}
  export function process(input: CustomType): Promise<CustomType>;
}
declare module 'existing-module' {
  interface ExistingInterface {
  newProperty: string
  newMethod(): void
}
  export function newFunction(): void;
}
declare namespace global {
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
declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}
declare module '*.svg' {
  const content: string;
  export default content;
}
export declare namespace Types {
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
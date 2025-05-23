export declare type DelimiterType = string
export const DefaultPhoneDelimiter: DelimiterType = '-'
export const DefaultPhonePattern: number[] = [3, 3, 4]

export interface FormatPhoneOptions {
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}

export const DefaultPhoneRegion = 'US'

const PHONE_PATTERNS: Record<string, number[]> = {
  US: [3, 3, 4],
  GB: [4, 3, 3],
  FR: [2, 2, 2, 2, 2],
  DE: [3, 2, 2, 2],
  JP: [3, 4, 4],
  CN: [3, 4, 4],
  IN: [4, 3, 3],
  BR: [2, 4, 4],
  AU: [4, 3, 3],
  CA: [3, 3, 4],
} as const

const COUNTRY_CODES: Record<string, string> = {
  US: '+1',
  GB: '+44',
  FR: '+33',
  DE: '+49',
  JP: '+81',
  CN: '+86',
  IN: '+91',
  BR: '+55',
  AU: '+61',
  CA: '+1',
}
declare function handleFormat({ value, delimiter, pattern, region, includeCountryCode, format }: {
  value: string
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}): string;
export declare function formatPhone(value: string, options?: FormatPhoneOptions): string;
export declare function unformatPhone(value: string): string;
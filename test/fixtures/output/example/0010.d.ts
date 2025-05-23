export declare type DelimiterType = string
export declare const DefaultPhoneDelimiter: '-'
export declare const DefaultPhonePattern: readonly [3, 3, 4]

export interface FormatPhoneOptions {
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}

export declare const DefaultPhoneRegion: 'US'

declare const PHONE_PATTERNS: {
  readonly US: readonly [3, 3, 4]
  readonly GB: readonly [4, 3, 3]
  readonly FR: readonly [2, 2, 2, 2, 2]
  readonly DE: readonly [3, 2, 2, 2]
  readonly JP: readonly [3, 4, 4]
  readonly CN: readonly [3, 4, 4]
  readonly IN: readonly [4, 3, 3]
  readonly BR: readonly [2, 4, 4]
  readonly AU: readonly [4, 3, 3]
  readonly CA: readonly [3, 3, 4]
}

declare const COUNTRY_CODES: {
  readonly US: '+1'
  readonly GB: '+44'
  readonly FR: '+33'
  readonly DE: '+49'
  readonly JP: '+81'
  readonly CN: '+86'
  readonly IN: '+91'
  readonly BR: '+55'
  readonly AU: '+61'
  readonly CA: '+1'
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
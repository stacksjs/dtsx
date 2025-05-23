declare function handleFormat({
  value, delimiter, pattern, region, includeCountryCode, format, }: {
  value: string
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}): string;
export declare function formatPhone(value: string, options?: FormatPhoneOptions): string;
export declare function unformatPhone(value: string): string;
export declare const DefaultPhoneDelimiter: DelimiterType;
export declare const DefaultPhonePattern: number[];
export declare const DefaultPhoneRegion: 'US';
declare const PHONE_PATTERNS: Record<string, number[]>;
declare const COUNTRY_CODES: Record<string, string>;
// Remove all non-digit characters
declare const digits: unknown;
// Apply pattern
declare let result: string;
declare let digitIndex: unknown;
// Use region pattern if no custom pattern provided
declare const selectedPattern: unknown;
export declare interface FormatPhoneOptions {
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}
export type DelimiterType = string
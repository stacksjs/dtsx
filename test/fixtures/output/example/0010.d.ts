export declare function formatPhone(value: string, options?: FormatPhoneOptions): string;
export declare function unformatPhone(value: string): string;
export declare const DefaultPhoneDelimiter: DelimiterType;
export declare const DefaultPhonePattern: number[];
export declare const DefaultPhoneRegion: any;
export declare const PHONE_PATTERNS: Record<string, number[]>;
export declare const COUNTRY_CODES: Record<string, string>;
export declare interface FormatPhoneOptions {
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}
export type DelimiterType = string
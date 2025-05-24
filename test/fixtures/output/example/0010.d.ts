export declare function formatPhone(value: string, options?: FormatPhoneOptions): string;
export declare function unformatPhone(value: string): string;
export declare const DefaultPhoneDelimiter: DelimiterType;
export declare const DefaultPhonePattern: number[];
export declare const DefaultPhoneRegion: 'US';
export declare const PHONE_PATTERNS: {
  US: readonly [3, 3, 4];
  GB: readonly [4, 3, 3];
  FR: readonly [2, 2, 2, 2, 2];
  DE: readonly [3, 2, 2, 2];
  JP: readonly [3, 4, 4];
  CN: readonly [3, 4, 4];
  IN: readonly [4, 3, 3];
  BR: readonly [2, 4, 4];
  AU: readonly [4, 3, 3];
  CA: readonly [3, 3, 4]
};
export declare const COUNTRY_CODES: {
  US: '+1';
  GB: '+44';
  FR: '+33';
  DE: '+49';
  JP: '+81';
  CN: '+86';
  IN: '+91';
  BR: '+55';
  AU: '+61';
  CA: '+1'
};
export declare interface FormatPhoneOptions {
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}
export type DelimiterType = string
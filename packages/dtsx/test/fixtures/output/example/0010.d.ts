export declare function formatPhone(value: string, options?: FormatPhoneOptions): string;
export declare function unformatPhone(value: string): string;
export declare const DefaultPhoneDelimiter: DelimiterType;
export declare const DefaultPhonePattern: number[];
export declare const DefaultPhoneRegion: 'US';
/**
 * @defaultValue
 * ```ts
 * {
 *   US: [3, 3, 4],
 *   GB: [4, 3, 3],
 *   FR: [2, 2, 2, 2, 2],
 *   DE: [3, 2, 2, 2],
 *   JP: [3, 4, 4],
 *   CN: [3, 4, 4],
 *   IN: [4, 3, 3],
 *   BR: [2, 4, 4],
 *   AU: [4, 3, 3],
 *   CA: [3, 3, 4]
 * }
 * ```
 */
export declare const PHONE_PATTERNS: Record<string, number[]>;
/**
 * @defaultValue
 * ```ts
 * {
 *   US: '+1',
 *   GB: '+44',
 *   FR: '+33',
 *   DE: '+49',
 *   JP: '+81',
 *   CN: '+86',
 *   IN: '+91',
 *   BR: '+55',
 *   AU: '+61',
 *   CA: '+1'
 * }
 * ```
 */
export declare const COUNTRY_CODES: Record<string, string>;
export declare interface FormatPhoneOptions {
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}
export type DelimiterType = string;

export type DelimiterType = string
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

export const PHONE_PATTERNS: Record<string, number[]> = {
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

export const COUNTRY_CODES: Record<string, string> = {
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

function handleFormat({
  value,
  delimiter,
  pattern,
  region,
  includeCountryCode,
  format,
}: {
  value: string
  delimiter?: string
  pattern?: number[]
  region?: string
  includeCountryCode?: boolean
  format?: 'national' | 'international'
}): string {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '')

  // Apply pattern
  let result = ''
  let digitIndex = 0

  for (let i = 0; i < pattern.length; i++) {
    const groupSize = pattern[i]
    const group = digits.slice(digitIndex, digitIndex + groupSize)

    if (group) {
      if (result) {
        result += delimiter
      }
      result += group
      digitIndex += groupSize
    }
  }

  // Add country code if needed
  if (includeCountryCode && format === 'international' && COUNTRY_CODES[region]) {
    result = `${COUNTRY_CODES[region]} ${result}`
  }

  return result
}

export function formatPhone(value: string, options?: FormatPhoneOptions): string {
  const {
    delimiter = DefaultPhoneDelimiter,
    pattern,
    region = DefaultPhoneRegion,
    includeCountryCode = false,
    format = 'national',
  } = options ?? {}

  // Use region pattern if no custom pattern provided
  const selectedPattern = pattern ?? PHONE_PATTERNS[region] ?? DefaultPhonePattern

  return handleFormat({
    value,
    delimiter,
    pattern: selectedPattern,
    region,
    includeCountryCode,
    format,
  })
}

export function unformatPhone(value: string): string {
  return value.replace(/\D/g, '')
}

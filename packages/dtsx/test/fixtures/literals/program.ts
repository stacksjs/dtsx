// Mirrors ts-tokens/packages/ts-tokens/src/staking/program.ts — multi-part
// string-literal concatenation plus numeric arithmetic initializers.
export const STAKING_PROGRAM_NOT_DEPLOYED =
  'Staking program is not deployed (STAKING_PROGRAM_ID is a placeholder); ' +
  'staking transactions cannot be submitted'

export const STAKING_TIMEOUT = 60 * 1000

export const STAKING_PREFIX = 'staking' + ':' + 'v1'

export const STAKING_LABEL = 'staking: ' + String('v1')

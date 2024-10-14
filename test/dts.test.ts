import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { generate } from '../src/generate'
import type { DtsGenerationOption } from '../src/types'

describe('@stacksjs/reverse-proxy', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test'
  })

  // describe...
})

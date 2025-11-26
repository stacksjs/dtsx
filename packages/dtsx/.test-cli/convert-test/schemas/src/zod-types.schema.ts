import { z } from 'zod'

export const ConfigSchema = z.unknown()

export type Config = z.infer<typeof ConfigSchema>

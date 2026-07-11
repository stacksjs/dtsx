/**
 * Normalize user-provided batch sizes so loops always make forward progress.
 */
export function normalizeConcurrency(value: number | undefined, fallback: number): number {
  const normalizedFallback = Number.isFinite(fallback) ? Math.max(1, Math.floor(fallback)) : 1
  if (value === undefined || !Number.isFinite(value)) return normalizedFallback
  return Math.max(1, Math.floor(value))
}

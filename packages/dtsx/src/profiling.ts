/**
 * Performance profiling for dtsx
 *
 * Provides utilities to profile:
 * - Memory usage and limits
 * - CPU time and sampling
 * - I/O operations
 */

import type { ProfilingConfig } from './types'

/**
 * Memory profiling data snapshot
 */
export interface MemoryProfileSnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
}

/**
 * CPU profiling data
 */
export interface CpuProfile {
  timestamp: number
  user: number
  system: number
  total: number
}

/**
 * I/O operation record
 */
export interface IoOperation {
  timestamp: number
  operation: 'read' | 'write'
  path: string
  size: number
  durationMs: number
}

/**
 * Profiling results
 */
export interface ProfilingResults {
  startTime: number
  endTime: number
  durationMs: number
  memory: {
    samples: MemoryProfileSnapshot[]
    peak: MemoryProfileSnapshot
    average: MemoryProfileSnapshot
    warnings: string[]
  }
  cpu: {
    samples: CpuProfile[]
    totalUser: number
    totalSystem: number
  }
  io: {
    operations: IoOperation[]
    totalReads: number
    totalWrites: number
    totalReadBytes: number
    totalWriteBytes: number
    totalReadMs: number
    totalWriteMs: number
  }
}

/**
 * Profiler class for collecting performance data
 */
export class Profiler {
  private config: Required<ProfilingConfig>
  private memorySamples: MemoryProfileSnapshot[] = []
  private cpuSamples: CpuProfile[] = []
  private ioOperations: IoOperation[] = []
  private startTime: number = 0
  private memoryInterval: ReturnType<typeof setInterval> | null = null
  private cpuInterval: ReturnType<typeof setInterval> | null = null
  private lastCpuUsage: { user: number, system: number } | null = null
  private isRunning: boolean = false

  constructor(config: ProfilingConfig = {}) {
    this.config = {
      memory: config.memory ?? false,
      memoryLimit: config.memoryLimit ?? 1024,
      cpu: config.cpu ?? false,
      samplingInterval: config.samplingInterval ?? 100,
      io: config.io ?? false,
      trackOperations: config.trackOperations ?? ['read', 'write'],
      outputFile: config.outputFile ?? '',
    }
  }

  /**
   * Start profiling
   */
  start(): void {
    if (this.isRunning)
      return

    this.isRunning = true
    this.startTime = Date.now()
    this.memorySamples = []
    this.cpuSamples = []
    this.ioOperations = []
    this.lastCpuUsage = null

    // Start memory sampling
    if (this.config.memory) {
      this.sampleMemory()
      this.memoryInterval = setInterval(
        () => this.sampleMemory(),
        this.config.samplingInterval,
      )
    }

    // Start CPU sampling
    if (this.config.cpu) {
      this.sampleCpu()
      this.cpuInterval = setInterval(
        () => this.sampleCpu(),
        this.config.samplingInterval,
      )
    }
  }

  /**
   * Stop profiling
   */
  stop(): void {
    if (!this.isRunning)
      return

    this.isRunning = false

    if (this.memoryInterval) {
      clearInterval(this.memoryInterval)
      this.memoryInterval = null
    }

    if (this.cpuInterval) {
      clearInterval(this.cpuInterval)
      this.cpuInterval = null
    }
  }

  /**
   * Sample current memory usage
   */
  private sampleMemory(): void {
    const sample = getMemoryUsage()
    this.memorySamples.push(sample)
  }

  /**
   * Sample current CPU usage
   */
  private sampleCpu(): void {
    const current = getCpuUsage()

    if (this.lastCpuUsage) {
      const sample: CpuProfile = {
        timestamp: Date.now(),
        user: current.user - this.lastCpuUsage.user,
        system: current.system - this.lastCpuUsage.system,
        total: (current.user - this.lastCpuUsage.user) + (current.system - this.lastCpuUsage.system),
      }
      this.cpuSamples.push(sample)
    }

    this.lastCpuUsage = current
  }

  /**
   * Record an I/O operation
   */
  recordIo(operation: 'read' | 'write', path: string, size: number, durationMs: number): void {
    if (!this.config.io)
      return
    if (!this.config.trackOperations.includes(operation))
      return

    this.ioOperations.push({
      timestamp: Date.now(),
      operation,
      path,
      size,
      durationMs,
    })
  }

  /**
   * Get profiling results
   */
  getResults(): ProfilingResults {
    const endTime = Date.now()

    // Calculate memory stats
    const memoryWarnings: string[] = []
    let peakMemory = this.memorySamples[0] || getMemoryUsage()
    let totalHeapUsed = 0

    for (const sample of this.memorySamples) {
      totalHeapUsed += sample.heapUsed
      if (sample.heapUsed > peakMemory.heapUsed) {
        peakMemory = sample
      }

      // Check memory limit
      const heapMB = sample.heapUsed / (1024 * 1024)
      if (heapMB > this.config.memoryLimit) {
        memoryWarnings.push(
          `Memory limit exceeded at ${new Date(sample.timestamp).toISOString()}: ${heapMB.toFixed(2)}MB > ${this.config.memoryLimit}MB`,
        )
      }
    }

    const avgHeapUsed = this.memorySamples.length > 0
      ? totalHeapUsed / this.memorySamples.length
      : 0

    // Calculate CPU stats
    let totalUser = 0
    let totalSystem = 0
    for (const sample of this.cpuSamples) {
      totalUser += sample.user
      totalSystem += sample.system
    }

    // Calculate I/O stats
    let totalReads = 0
    let totalWrites = 0
    let totalReadBytes = 0
    let totalWriteBytes = 0
    let totalReadMs = 0
    let totalWriteMs = 0

    for (const op of this.ioOperations) {
      if (op.operation === 'read') {
        totalReads++
        totalReadBytes += op.size
        totalReadMs += op.durationMs
      }
      else {
        totalWrites++
        totalWriteBytes += op.size
        totalWriteMs += op.durationMs
      }
    }

    return {
      startTime: this.startTime,
      endTime,
      durationMs: endTime - this.startTime,
      memory: {
        samples: this.memorySamples,
        peak: peakMemory,
        average: {
          timestamp: 0,
          heapUsed: avgHeapUsed,
          heapTotal: 0,
          external: 0,
          arrayBuffers: 0,
          rss: 0,
        },
        warnings: memoryWarnings,
      },
      cpu: {
        samples: this.cpuSamples,
        totalUser,
        totalSystem,
      },
      io: {
        operations: this.ioOperations,
        totalReads,
        totalWrites,
        totalReadBytes,
        totalWriteBytes,
        totalReadMs,
        totalWriteMs,
      },
    }
  }

  /**
   * Format results as human-readable string
   */
  formatResults(): string {
    const results = this.getResults()
    const lines: string[] = ['=== Profiling Results ===', '']

    lines.push(`Duration: ${results.durationMs}ms`)
    lines.push('')

    // Memory
    if (this.config.memory) {
      lines.push('Memory:')
      lines.push(`  Samples: ${results.memory.samples.length}`)
      lines.push(`  Peak heap: ${formatBytes(results.memory.peak.heapUsed)}`)
      lines.push(`  Average heap: ${formatBytes(results.memory.average.heapUsed)}`)

      if (results.memory.warnings.length > 0) {
        lines.push('  Warnings:')
        for (const warning of results.memory.warnings) {
          lines.push(`    - ${warning}`)
        }
      }
      lines.push('')
    }

    // CPU
    if (this.config.cpu) {
      lines.push('CPU:')
      lines.push(`  Samples: ${results.cpu.samples.length}`)
      lines.push(`  Total user time: ${(results.cpu.totalUser / 1000).toFixed(2)}ms`)
      lines.push(`  Total system time: ${(results.cpu.totalSystem / 1000).toFixed(2)}ms`)
      lines.push('')
    }

    // I/O
    if (this.config.io) {
      lines.push('I/O:')
      lines.push(`  Total reads: ${results.io.totalReads}`)
      lines.push(`  Total writes: ${results.io.totalWrites}`)
      lines.push(`  Total read: ${formatBytes(results.io.totalReadBytes)} in ${results.io.totalReadMs.toFixed(2)}ms`)
      lines.push(`  Total write: ${formatBytes(results.io.totalWriteBytes)} in ${results.io.totalWriteMs.toFixed(2)}ms`)
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Write results to file
   */
  async writeResults(): Promise<void> {
    if (!this.config.outputFile)
      return

    const results = this.getResults()
    const json = JSON.stringify(results, null, 2)

    // Use dynamic import to avoid issues with file system
    try {
      const fs = await import('node:fs/promises')
      await fs.writeFile(this.config.outputFile, json, 'utf-8')
    }
    catch {
      // Fallback for Bun
      await Bun.write(this.config.outputFile, json)
    }
  }
}

/**
 * Get current memory usage
 */
function getMemoryUsage(): MemoryProfileSnapshot {
  // Try to get Node.js process memory
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage()
    return {
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers || 0,
      rss: mem.rss,
    }
  }

  // Fallback for environments without process.memoryUsage
  return {
    timestamp: Date.now(),
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
    rss: 0,
  }
}

/**
 * Get current CPU usage
 */
function getCpuUsage(): { user: number, system: number } {
  // Try to get Node.js process CPU usage
  if (typeof process !== 'undefined' && process.cpuUsage) {
    const cpu = process.cpuUsage()
    return {
      user: cpu.user,
      system: cpu.system,
    }
  }

  // Fallback for environments without process.cpuUsage
  return {
    user: 0,
    system: 0,
  }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0)
    return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${units[i]}`
}

/**
 * Create a new profiler instance
 */
export function createProfiler(config?: ProfilingConfig): Profiler {
  return new Profiler(config)
}

/**
 * Profile a function execution
 */
export async function profileExecution<T>(
  fn: () => T | Promise<T>,
  config?: ProfilingConfig,
): Promise<{ result: T, profile: ProfilingResults }> {
  const profiler = createProfiler({
    memory: true,
    cpu: true,
    ...config,
  })

  profiler.start()
  try {
    const result = await fn()
    return { result, profile: profiler.getResults() }
  }
  finally {
    profiler.stop()
  }
}

/**
 * Create a profiled I/O wrapper
 */
export function createProfiledIo(profiler: Profiler): {
  read: <T>(path: string, fn: () => Promise<T>) => Promise<T>
  write: (path: string, fn: () => Promise<void>, size: number) => Promise<void>
} {
  return {
    async read<T>(path: string, fn: () => Promise<T>): Promise<T> {
      const start = Date.now()
      try {
        const result = await fn()
        const size = typeof result === 'string' ? result.length : 0
        profiler.recordIo('read', path, size, Date.now() - start)
        return result
      }
      catch (error) {
        profiler.recordIo('read', path, 0, Date.now() - start)
        throw error
      }
    },

    async write(path: string, fn: () => Promise<void>, size: number): Promise<void> {
      const start = Date.now()
      try {
        await fn()
        profiler.recordIo('write', path, size, Date.now() - start)
      }
      catch (error) {
        profiler.recordIo('write', path, 0, Date.now() - start)
        throw error
      }
    },
  }
}

/**
 * Simple timer for manual profiling
 */
export class Timer {
  private marks: Map<string, number> = new Map()
  private durations: Map<string, number[]> = new Map()

  /**
   * Mark a point in time
   */
  mark(name: string): void {
    this.marks.set(name, performance.now())
  }

  /**
   * Measure duration since a mark
   */
  measure(name: string, fromMark: string): number {
    const from = this.marks.get(fromMark)
    if (from === undefined) {
      throw new Error(`Mark "${fromMark}" not found`)
    }

    const duration = performance.now() - from
    const existing = this.durations.get(name) || []
    existing.push(duration)
    this.durations.set(name, existing)

    return duration
  }

  /**
   * Get all durations for a measurement
   */
  getDurations(name: string): number[] {
    return this.durations.get(name) || []
  }

  /**
   * Get average duration for a measurement
   */
  getAverage(name: string): number {
    const durations = this.getDurations(name)
    if (durations.length === 0)
      return 0
    return durations.reduce((a, b) => a + b, 0) / durations.length
  }

  /**
   * Get all measurements summary
   */
  getSummary(): Map<string, { count: number, total: number, average: number, min: number, max: number }> {
    const summary = new Map()
    for (const [name, durations] of this.durations) {
      summary.set(name, {
        count: durations.length,
        total: durations.reduce((a, b) => a + b, 0),
        average: durations.reduce((a, b) => a + b, 0) / durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
      })
    }
    return summary
  }

  /**
   * Clear all marks and durations
   */
  clear(): void {
    this.marks.clear()
    this.durations.clear()
  }
}

/**
 * Create a simple timer
 */
export function createTimer(): Timer {
  return new Timer()
}

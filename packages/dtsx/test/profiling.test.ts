/**
 * Tests for performance profiling
 */

import { describe, expect, test } from 'bun:test'
import {
  createProfiledIo,
  createProfiler,
  createTimer,
  profileExecution,
  Profiler,
  Timer,
} from '../src/profiling'

describe('Profiling Module', () => {
  describe('Profiler', () => {
    test('creates profiler with default config', () => {
      const profiler = createProfiler()
      expect(profiler).toBeInstanceOf(Profiler)
    })

    test('creates profiler with custom config', () => {
      const profiler = createProfiler({
        memory: true,
        cpu: true,
        io: true,
      })
      expect(profiler).toBeInstanceOf(Profiler)
    })

    test('starts and stops profiling', () => {
      const profiler = createProfiler({ memory: true })

      profiler.start()
      // Let it run briefly
      profiler.stop()

      const results = profiler.getResults()
      expect(results.durationMs).toBeGreaterThanOrEqual(0)
    })

    test('samples memory usage', async () => {
      const profiler = createProfiler({
        memory: true,
        samplingInterval: 10,
      })

      profiler.start()

      // Wait for some samples
      await new Promise(resolve => setTimeout(resolve, 50))

      profiler.stop()

      const results = profiler.getResults()
      expect(results.memory.samples.length).toBeGreaterThan(0)
    })

    test('samples CPU usage', async () => {
      const profiler = createProfiler({
        cpu: true,
        samplingInterval: 10,
      })

      profiler.start()

      // Do some CPU work
      let sum = 0
      for (let i = 0; i < 100000; i++) {
        sum += i
      }

      await new Promise(resolve => setTimeout(resolve, 50))

      profiler.stop()

      const results = profiler.getResults()
      // CPU samples may be 0 in some environments
      expect(results.cpu.samples).toBeDefined()
      expect(sum).toBeGreaterThan(0) // Use sum to avoid unused warning
    })

    test('records I/O operations', () => {
      const profiler = createProfiler({ io: true })

      profiler.start()
      profiler.recordIo('read', '/test/file.ts', 1024, 5)
      profiler.recordIo('write', '/test/output.d.ts', 512, 3)
      profiler.stop()

      const results = profiler.getResults()
      expect(results.io.operations.length).toBe(2)
      expect(results.io.totalReads).toBe(1)
      expect(results.io.totalWrites).toBe(1)
      expect(results.io.totalReadBytes).toBe(1024)
      expect(results.io.totalWriteBytes).toBe(512)
    })

    test('tracks peak memory', async () => {
      const profiler = createProfiler({
        memory: true,
        samplingInterval: 10,
      })

      profiler.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      profiler.stop()

      const results = profiler.getResults()
      expect(results.memory.peak).toBeDefined()
      expect(results.memory.peak.heapUsed).toBeGreaterThanOrEqual(0)
    })

    test('warns on memory limit exceeded', async () => {
      const profiler = createProfiler({
        memory: true,
        memoryLimit: 0.001, // Very low limit (1KB)
        samplingInterval: 10,
      })

      profiler.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      profiler.stop()

      const results = profiler.getResults()
      // Should have warnings since limit is so low
      expect(results.memory.warnings.length).toBeGreaterThan(0)
    })

    test('formats results as string', () => {
      const profiler = createProfiler({
        memory: true,
        cpu: true,
        io: true,
      })

      profiler.start()
      profiler.recordIo('read', '/test.ts', 100, 1)
      profiler.stop()

      const formatted = profiler.formatResults()
      expect(formatted).toContain('Profiling Results')
      expect(formatted).toContain('Duration')
      expect(formatted).toContain('Memory')
      expect(formatted).toContain('CPU')
      expect(formatted).toContain('I/O')
    })

    test('filters I/O operations by type', () => {
      const profiler = createProfiler({
        io: true,
        trackOperations: ['read'], // Only track reads
      })

      profiler.start()
      profiler.recordIo('read', '/test.ts', 100, 1)
      profiler.recordIo('write', '/output.d.ts', 50, 1) // Should be ignored
      profiler.stop()

      const results = profiler.getResults()
      expect(results.io.totalReads).toBe(1)
      expect(results.io.totalWrites).toBe(0)
    })

    test('handles multiple start/stop cycles', async () => {
      const profiler = createProfiler({ memory: true, samplingInterval: 10 })

      // First cycle
      profiler.start()
      await new Promise(resolve => setTimeout(resolve, 20))
      profiler.stop()

      const results1 = profiler.getResults()

      // Second cycle (should reset)
      profiler.start()
      await new Promise(resolve => setTimeout(resolve, 20))
      profiler.stop()

      const results2 = profiler.getResults()

      // Results should be independent
      expect(results2.startTime).toBeGreaterThan(results1.startTime)
    })
  })

  describe('profileExecution', () => {
    test('profiles sync function', async () => {
      const { result, profile } = await profileExecution(() => {
        let sum = 0
        for (let i = 0; i < 1000; i++) {
          sum += i
        }
        return sum
      })

      expect(result).toBe(499500)
      expect(profile.durationMs).toBeGreaterThanOrEqual(0)
    })

    test('profiles async function', async () => {
      const { result, profile } = await profileExecution(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'done'
      })

      expect(result).toBe('done')
      expect(profile.durationMs).toBeGreaterThanOrEqual(9)
    })

    test('includes memory samples', async () => {
      const { profile } = await profileExecution(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return 'done'
      }, { samplingInterval: 10 })

      expect(profile.memory.samples.length).toBeGreaterThan(0)
    })
  })

  describe('createProfiledIo', () => {
    test('profiles read operations', async () => {
      const profiler = createProfiler({ io: true })
      const profiledIo = createProfiledIo(profiler)

      profiler.start()

      const result = await profiledIo.read('/test.ts', async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return 'file content'
      })

      profiler.stop()

      expect(result).toBe('file content')

      const results = profiler.getResults()
      expect(results.io.totalReads).toBe(1)
    })

    test('profiles write operations', async () => {
      const profiler = createProfiler({ io: true })
      const profiledIo = createProfiledIo(profiler)

      profiler.start()

      await profiledIo.write('/output.d.ts', async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
      }, 100)

      profiler.stop()

      const results = profiler.getResults()
      expect(results.io.totalWrites).toBe(1)
      expect(results.io.totalWriteBytes).toBe(100)
    })

    test('records I/O errors', async () => {
      const profiler = createProfiler({ io: true })
      const profiledIo = createProfiledIo(profiler)

      profiler.start()

      try {
        await profiledIo.read('/nonexistent.ts', async () => {
          throw new Error('File not found')
        })
      }
      catch {
        // Expected
      }

      profiler.stop()

      const results = profiler.getResults()
      // Should still record the operation
      expect(results.io.totalReads).toBe(1)
    })
  })

  describe('Timer', () => {
    test('creates timer', () => {
      const timer = createTimer()
      expect(timer).toBeInstanceOf(Timer)
    })

    test('marks and measures', () => {
      const timer = createTimer()

      timer.mark('start')

      // Do some work
      let sum = 0
      for (let i = 0; i < 1000; i++) {
        sum += i
      }

      const duration = timer.measure('work', 'start')
      expect(duration).toBeGreaterThanOrEqual(0)
      expect(sum).toBe(499500)
    })

    test('tracks multiple measurements', () => {
      const timer = createTimer()

      for (let i = 0; i < 5; i++) {
        timer.mark(`iteration-${i}`)
        timer.measure(`loop`, `iteration-${i}`)
      }

      const durations = timer.getDurations('loop')
      expect(durations.length).toBe(5)
    })

    test('calculates average', () => {
      const timer = createTimer()

      for (let i = 0; i < 3; i++) {
        timer.mark(`start-${i}`)
        timer.measure('test', `start-${i}`)
      }

      const avg = timer.getAverage('test')
      expect(avg).toBeGreaterThanOrEqual(0)
    })

    test('gets summary', () => {
      const timer = createTimer()

      timer.mark('a')
      timer.measure('test1', 'a')

      timer.mark('b')
      timer.measure('test2', 'b')

      const summary = timer.getSummary()
      expect(summary.size).toBe(2)
      expect(summary.has('test1')).toBe(true)
      expect(summary.has('test2')).toBe(true)

      const test1Summary = summary.get('test1')
      expect(test1Summary?.count).toBe(1)
    })

    test('clears data', () => {
      const timer = createTimer()

      timer.mark('start')
      timer.measure('test', 'start')

      expect(timer.getDurations('test').length).toBe(1)

      timer.clear()

      expect(timer.getDurations('test').length).toBe(0)
    })

    test('throws on missing mark', () => {
      const timer = createTimer()

      expect(() => {
        timer.measure('test', 'nonexistent')
      }).toThrow('Mark "nonexistent" not found')
    })
  })
})

/**
 * Worker thread support for parallel file processing
 * Uses Bun workers for high-performance parallel declaration generation
 */

import type { Declaration, DtsGenerationConfig } from './types'
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { logger } from './logger'

/**
 * Worker pool configuration
 */
export interface WorkerPoolConfig {
  /**
   * Number of worker threads
   * @default CPU count - 1
   */
  maxWorkers?: number

  /**
   * Task timeout in milliseconds
   * @default 30000
   */
  taskTimeout?: number

  /**
   * Enable worker recycling after N tasks
   * @default 100
   */
  recycleAfter?: number

  /**
   * Idle timeout before terminating workers
   * @default 10000
   */
  idleTimeout?: number
}

/**
 * Task to be processed by a worker
 */
export interface WorkerTask {
  id: string
  type: 'process' | 'extract' | 'transform'
  filePath: string
  sourceCode: string
  config: Partial<DtsGenerationConfig>
}

/**
 * Result from a worker task
 */
export interface WorkerResult {
  id: string
  success: boolean
  filePath: string
  content?: string
  declarations?: Declaration[]
  error?: string
  duration: number
}

/**
 * Worker statistics
 */
export interface WorkerStats {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  averageDuration: number
  activeWorkers: number
  idleWorkers: number
}

/**
 * Worker instance wrapper
 */
interface WorkerInstance {
  worker: Worker
  busy: boolean
  taskCount: number
  lastActive: number
}

/**
 * Worker pool for parallel processing
 */
export class WorkerPool {
  private workers: WorkerInstance[] = []
  private taskQueue: Array<{
    task: WorkerTask
    resolve: (result: WorkerResult) => void
    reject: (error: Error) => void
  }> = []

  private config: Required<WorkerPoolConfig>
  private stats: WorkerStats = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    averageDuration: 0,
    activeWorkers: 0,
    idleWorkers: 0,
  }

  private isShuttingDown = false
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: WorkerPoolConfig = {}) {
    this.config = {
      maxWorkers: config.maxWorkers ?? Math.max(1, cpus().length - 1),
      taskTimeout: config.taskTimeout ?? 30000,
      recycleAfter: config.recycleAfter ?? 100,
      idleTimeout: config.idleTimeout ?? 10000,
    }
  }

  /**
   * Initialize the worker pool
   */
  async init(): Promise<void> {
    // Create initial workers
    const initialWorkers = Math.min(2, this.config.maxWorkers)
    for (let i = 0; i < initialWorkers; i++) {
      this.createWorker()
    }

    // Start idle check
    this.idleCheckInterval = setInterval(() => {
      this.checkIdleWorkers()
    }, 5000)
  }

  /**
   * Create a new worker
   */
  private createWorker(): WorkerInstance {
    const workerCode = `
      const { parentPort } = require('worker_threads');

      // Dynamic import for ESM compatibility
      async function processTask(task) {
        const startTime = Date.now();

        try {
          // Import the processing functions
          const { extractDeclarations } = await import('${resolve(__dirname, 'extractor.js')}');
          const { processDeclarations } = await import('${resolve(__dirname, 'processor.js')}');

          if (task.type === 'extract') {
            const declarations = extractDeclarations(task.sourceCode, task.filePath, task.config?.keepComments);
            return {
              id: task.id,
              success: true,
              filePath: task.filePath,
              declarations,
              duration: Date.now() - startTime,
            };
          }

          if (task.type === 'process') {
            const declarations = extractDeclarations(task.sourceCode, task.filePath, task.config?.keepComments);
            const content = processDeclarations(declarations, {
              filePath: task.filePath,
              sourceCode: task.sourceCode,
              declarations,
            }, true, task.config?.importOrder);

            return {
              id: task.id,
              success: true,
              filePath: task.filePath,
              content,
              declarations,
              duration: Date.now() - startTime,
            };
          }

          throw new Error('Unknown task type: ' + task.type);
        } catch (error) {
          return {
            id: task.id,
            success: false,
            filePath: task.filePath,
            error: error.message,
            duration: Date.now() - startTime,
          };
        }
      }

      parentPort.on('message', async (task) => {
        const result = await processTask(task);
        parentPort.postMessage(result);
      });
    `

    const worker = new Worker(workerCode, { eval: true })

    const instance: WorkerInstance = {
      worker,
      busy: false,
      taskCount: 0,
      lastActive: Date.now(),
    }

    worker.on('message', (result: WorkerResult) => {
      this.handleWorkerResult(instance, result)
    })

    worker.on('error', (error) => {
      logger.error('Worker error:', error)
      this.handleWorkerError(instance, error)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && !this.isShuttingDown) {
        logger.error(`Worker exited with code ${code}`)
        this.removeWorker(instance)
      }
    })

    this.workers.push(instance)
    this.updateStats()

    return instance
  }

  /**
   * Handle worker result
   */
  private handleWorkerResult(instance: WorkerInstance, result: WorkerResult): void {
    instance.busy = false
    instance.taskCount++
    instance.lastActive = Date.now()

    // Update stats
    if (result.success) {
      this.stats.completedTasks++
    }
    else {
      this.stats.failedTasks++
    }

    const totalDuration = this.stats.averageDuration * (this.stats.completedTasks + this.stats.failedTasks - 1) + result.duration
    this.stats.averageDuration = totalDuration / (this.stats.completedTasks + this.stats.failedTasks)

    this.updateStats()

    // Check if worker needs recycling
    if (instance.taskCount >= this.config.recycleAfter) {
      this.recycleWorker(instance)
    }

    // Process next task in queue
    this.processQueue()
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(instance: WorkerInstance, _error: Error): void {
    instance.busy = false
    this.stats.failedTasks++
    this.updateStats()

    // Recycle the worker
    this.recycleWorker(instance)

    // Process next task
    this.processQueue()
  }

  /**
   * Remove a worker from the pool
   */
  private removeWorker(instance: WorkerInstance): void {
    const index = this.workers.indexOf(instance)
    if (index !== -1) {
      this.workers.splice(index, 1)
      instance.worker.terminate()
    }
    this.updateStats()
  }

  /**
   * Recycle a worker (terminate and create new)
   */
  private recycleWorker(instance: WorkerInstance): void {
    this.removeWorker(instance)
    if (!this.isShuttingDown && this.workers.length < this.config.maxWorkers) {
      this.createWorker()
    }
  }

  /**
   * Check for idle workers and terminate if needed
   */
  private checkIdleWorkers(): void {
    const now = Date.now()
    const minWorkers = 1

    for (const instance of [...this.workers]) {
      if (
        !instance.busy
        && now - instance.lastActive > this.config.idleTimeout
        && this.workers.length > minWorkers
      ) {
        this.removeWorker(instance)
      }
    }
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0)
      return

    // Find an available worker
    let worker = this.workers.find(w => !w.busy)

    // Create new worker if needed and under limit
    if (!worker && this.workers.length < this.config.maxWorkers) {
      worker = this.createWorker()
    }

    if (!worker)
      return

    const { task, resolve, reject } = this.taskQueue.shift()!

    worker.busy = true
    worker.lastActive = Date.now()

    // Set timeout
    const timeout = setTimeout(() => {
      reject(new Error(`Task ${task.id} timed out`))
      this.recycleWorker(worker!)
    }, this.config.taskTimeout)

    // Store resolve/reject for later
    const originalResolve = resolve
    const wrappedResolve = (result: WorkerResult) => {
      clearTimeout(timeout)
      originalResolve(result)
    }

    // Listen for this specific task result
    const handler = (result: WorkerResult) => {
      if (result.id === task.id) {
        wrappedResolve(result)
      }
    }

    worker.worker.once('message', handler)
    worker.worker.postMessage(task)

    this.updateStats()
  }

  /**
   * Submit a task to the pool
   */
  async submit(task: WorkerTask): Promise<WorkerResult> {
    this.stats.totalTasks++

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject })
      this.processQueue()
    })
  }

  /**
   * Process multiple files in parallel
   */
  async processFiles(
    files: Array<{ path: string, content: string }>,
    config: Partial<DtsGenerationConfig> = {},
  ): Promise<WorkerResult[]> {
    const tasks = files.map((file, index) => ({
      id: `task-${index}-${Date.now()}`,
      type: 'process' as const,
      filePath: file.path,
      sourceCode: file.content,
      config,
    }))

    return Promise.all(tasks.map(task => this.submit(task)))
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    this.stats.activeWorkers = this.workers.filter(w => w.busy).length
    this.stats.idleWorkers = this.workers.filter(w => !w.busy).length
  }

  /**
   * Get current statistics
   */
  getStats(): WorkerStats {
    return { ...this.stats }
  }

  /**
   * Shutdown the worker pool
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
    }

    // Wait for pending tasks
    while (this.taskQueue.length > 0 || this.workers.some(w => w.busy)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Terminate all workers
    await Promise.all(
      this.workers.map(instance => instance.worker.terminate()),
    )

    this.workers = []
  }
}

/**
 * Create a worker pool with default configuration
 */
export function createWorkerPool(config: WorkerPoolConfig = {}): WorkerPool {
  return new WorkerPool(config)
}

/**
 * Process files in parallel using a temporary worker pool
 */
export async function parallelProcess(
  files: Array<{ path: string, content: string }>,
  config: Partial<DtsGenerationConfig> = {},
  poolConfig: WorkerPoolConfig = {},
): Promise<WorkerResult[]> {
  const pool = createWorkerPool(poolConfig)
  await pool.init()

  try {
    return await pool.processFiles(files, config)
  }
  finally {
    await pool.shutdown()
  }
}

/**
 * Batch files into chunks for processing
 */
export function batchFiles<T>(files: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize))
  }
  return batches
}

/**
 * Calculate optimal batch size based on file count and CPU cores
 */
export function calculateOptimalBatchSize(fileCount: number, cpuCount: number = cpus().length): number {
  if (fileCount <= cpuCount) {
    return 1 // Process each file in its own task
  }

  // Aim for 2-4 tasks per worker for good load balancing
  const tasksPerWorker = 3
  const targetBatches = cpuCount * tasksPerWorker

  return Math.max(1, Math.ceil(fileCount / targetBatches))
}

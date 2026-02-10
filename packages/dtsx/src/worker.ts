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

  /**
   * Initial number of workers to pre-spawn
   * @default min(2, maxWorkers)
   */
  initialWorkers?: number
}

/**
 * Task to be processed by a worker
 */
export interface WorkerTask {
  id: string
  type: 'process' | 'extract' | 'transform' | 'process-batch'
  filePath: string
  sourceCode?: string
  files?: Array<{ filePath: string, sourceCode?: string, outPath?: string }>
  filePaths?: string[]
  sources?: string[]
  outPaths?: string[]
  config: Partial<DtsGenerationConfig>
  writeOutput?: boolean
}

/**
 * Result from a worker task
 */
export interface WorkerBatchResult {
  filePath: string
  success: boolean
  content?: string
  declarations?: Declaration[]
  error?: string
}

export interface WorkerResult {
  id: string
  success: boolean
  filePath: string
  content?: string
  declarations?: Declaration[]
  batchResults?: WorkerBatchResult[]
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
  currentTask: {
    id: string
    resolve: (result: WorkerResult) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  } | null
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
    const maxWorkers = config.maxWorkers ?? Math.max(1, cpus().length - 1)
    this.config = {
      maxWorkers,
      taskTimeout: config.taskTimeout ?? 30000,
      recycleAfter: config.recycleAfter ?? 100,
      idleTimeout: config.idleTimeout ?? 10000,
      initialWorkers: config.initialWorkers ?? Math.min(2, maxWorkers),
    }
  }

  /**
   * Initialize the worker pool
   */
  async init(): Promise<void> {
    // Create initial workers
    const initialWorkers = Math.min(this.config.initialWorkers, this.config.maxWorkers)
    for (let i = 0; i < initialWorkers; i++) {
      this.createWorker()
    }

    // Start idle check only when enabled
    if (this.config.idleTimeout > 0) {
      this.idleCheckInterval = setInterval(() => {
        this.checkIdleWorkers()
      }, 5000)
    }
  }

  /**
   * Create a new worker
   */
  private createWorker(): WorkerInstance {
    const workerCode = `
      const { parentPort } = require('worker_threads');
      const bun = typeof Bun !== 'undefined' ? Bun : null;
      const fs = bun ? null : require('node:fs');

      const libsPromise = (async () => {
        const { extractDeclarations } = await import('${resolve(__dirname, 'extractor.js')}');
        const { processDeclarations } = await import('${resolve(__dirname, 'processor.js')}');
        return { extractDeclarations, processDeclarations };
      })();

      // Dynamic import for ESM compatibility
      async function processTask(task) {
        const startTime = Date.now();

        try {
          const { extractDeclarations, processDeclarations } = await libsPromise;

          const keepComments = task.config?.keepComments;
          const isolatedDeclarations = task.config?.isolatedDeclarations;
          const importOrder = task.config?.importOrder;

          if (task.type === 'process-batch') {
            const filePaths = task.filePaths;
            const outPaths = task.outPaths;
            const files = filePaths ? null : (task.files || []);
            const fileCount = filePaths ? filePaths.length : files.length;
            const writeOutput = task.writeOutput === true;
            const results = writeOutput ? null : new Array(fileCount);
            let errorResults = null;

            let sources = task.sources;
            if (!sources && fileCount > 0) {
              const readPromises = new Array(fileCount);
              for (let i = 0; i < fileCount; i++) {
                const file = files ? files[i] : null;
                const sourceCode = file ? file.sourceCode : undefined;
                const filePath = filePaths ? filePaths[i] : file.filePath;
                if (sourceCode != null) {
                  readPromises[i] = Promise.resolve(sourceCode);
                } else if (bun) {
                  readPromises[i] = bun.file(filePath).text();
                } else {
                  readPromises[i] = Promise.resolve(fs.readFileSync(filePath, 'utf-8'));
                }
              }
              sources = await Promise.all(readPromises);
            }

            const ctx = { filePath: '', sourceCode: '', declarations: [] };
            const writePromises = writeOutput && bun ? new Array(fileCount) : null;
            let success = true;

            for (let i = 0; i < fileCount; i++) {
              const file = files ? files[i] : null;
              const filePath = filePaths ? filePaths[i] : file.filePath;
              const outPath = outPaths ? outPaths[i] : (file ? file.outPath : undefined);
              try {
                const sourceCode = sources ? sources[i] : (file?.sourceCode || '');
                const declarations = extractDeclarations(sourceCode, filePath, keepComments, isolatedDeclarations);
                ctx.filePath = filePath;
                ctx.sourceCode = sourceCode;
                ctx.declarations = declarations;
                const content = processDeclarations(declarations, ctx, true, importOrder);

                if (writeOutput) {
                  if (!outPath) {
                    throw new Error('Missing outPath for ' + filePath);
                  }
                  if (bun) {
                    writePromises[i] = bun.write(outPath, content);
                  } else {
                    fs.writeFileSync(outPath, content);
                  }
                } else if (results) {
                  results[i] = {
                    filePath,
                    success: true,
                    content,
                    declarations,
                  };
                }
              } catch (error) {
                const message = error && error.message ? error.message : String(error);
                if (writeOutput) {
                  if (!errorResults) {
                    errorResults = [];
                  }
                  errorResults.push({
                    filePath,
                    success: false,
                    error: message,
                  });
                } else if (results) {
                  results[i] = {
                    filePath,
                    success: false,
                    error: message,
                  };
                }
                success = false;
              }
            }

            if (writePromises) {
              await Promise.all(writePromises);
            }

            const errorMessage = errorResults?.length
              ? (errorResults[0].filePath + ': ' + (errorResults[0].error || 'Worker batch failed'))
              : undefined;

            return {
              id: task.id,
              success,
              filePath: task.filePath,
              batchResults: writeOutput ? errorResults || undefined : results,
              error: errorMessage,
              duration: Date.now() - startTime,
            };
          }

          if (task.type === 'extract') {
            const declarations = extractDeclarations(task.sourceCode, task.filePath, keepComments, isolatedDeclarations);
            return {
              id: task.id,
              success: true,
              filePath: task.filePath,
              declarations,
              duration: Date.now() - startTime,
            };
          }

          if (task.type === 'process') {
            const declarations = extractDeclarations(task.sourceCode, task.filePath, keepComments, isolatedDeclarations);
            const content = processDeclarations(declarations, {
              filePath: task.filePath,
              sourceCode: task.sourceCode,
              declarations,
            }, true, importOrder);

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
      currentTask: null,
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

    if (instance.currentTask && instance.currentTask.id === result.id) {
      clearTimeout(instance.currentTask.timeout)
      const { resolve } = instance.currentTask
      instance.currentTask = null
      resolve(result)
    }

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
    if (instance.currentTask) {
      clearTimeout(instance.currentTask.timeout)
      const { reject } = instance.currentTask
      instance.currentTask = null
      reject(_error)
    }
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

    for (let i = this.workers.length - 1; i >= 0; i--) {
      const instance = this.workers[i]
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
    while (this.taskQueue.length > 0) {
      // Find an available worker
      let worker: WorkerInstance | undefined
      for (let i = 0; i < this.workers.length; i++) {
        if (!this.workers[i].busy) { worker = this.workers[i]; break }
      }

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
        if (worker!.currentTask?.id === task.id) {
          worker!.currentTask = null
        }
        reject(new Error(`Task ${task.id} timed out`))
        this.recycleWorker(worker!)
      }, this.config.taskTimeout)

      worker.currentTask = {
        id: task.id,
        resolve,
        reject,
        timeout,
      }
      worker.worker.postMessage(task)

      this.updateStats()
    }
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
    let active = 0
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workers[i].busy) active++
    }
    this.stats.activeWorkers = active
    this.stats.idleWorkers = this.workers.length - active
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

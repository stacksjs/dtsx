/**
 * Worker thread entry for the declaration worker pool. It is a real module,
 * not an eval'd string, so a compiled `dtsx` binary can embed it (with its
 * bytecode) and workers no longer load emitter sources from disk at runtime.
 */
// @ts-nocheck -- message payloads are validated by the pool that sends them.
import * as nodeFs from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { extractDeclarations } from './extractor'
import { processDeclarations } from './processor'

const bun = typeof Bun !== 'undefined' ? Bun : null;
const fs = bun ? null : nodeFs;

const libsPromise = Promise.resolve({ extractDeclarations, processDeclarations });

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
          }
else if (bun) {
            readPromises[i] = bun.file(filePath).text();
          }
else {
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
          const content = processDeclarations(declarations, ctx, keepComments ?? true, importOrder);

          if (writeOutput) {
            if (!outPath) {
              throw new Error(`Missing outPath for ${filePath}`);
            }
            if (bun) {
              writePromises[i] = bun.write(outPath, content);
            }
else {
              fs.writeFileSync(outPath, content);
            }
          }
else if (results) {
            results[i] = {
              filePath,
              success: true,
              content,
              declarations,
            };
          }
        }
catch (error) {
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
          }
else if (results) {
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
        ? `${errorResults[0].filePath}: ${errorResults[0].error || 'Worker batch failed'}`
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
      }, keepComments ?? true, importOrder);

      return {
        id: task.id,
        success: true,
        filePath: task.filePath,
        content,
        declarations,
        duration: Date.now() - startTime,
      };
    }

    throw new Error(`Unknown task type: ${task.type}`);
  }
catch (error) {
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

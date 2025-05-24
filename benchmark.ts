/* eslint-disable no-console */
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { extractDeclarations } from './src/extractor'

async function benchmark() {
  console.log('🚀 DTS Extractor Performance Benchmark\n')

  // Test files of different complexities
  const testFiles = [
    'test/fixtures/input/example/0001.ts', // Simple
    'test/fixtures/input/example/0002.ts', // Medium
    'test/fixtures/input/example/0003.ts', // Complex
    'test/fixtures/input/example/0005.ts', // Very complex
  ]

  for (const filePath of testFiles) {
    try {
      const sourceCode = await readFile(filePath, 'utf-8')
      const fileSize = sourceCode.length
      const lineCount = sourceCode.split('\n').length

      console.log(`📁 ${filePath}`)
      console.log(`   Size: ${fileSize} chars, ${lineCount} lines`)

      // Warm up
      for (let i = 0; i < 3; i++) {
        extractDeclarations(sourceCode, filePath)
      }

      // Benchmark
      const iterations = 100
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        extractDeclarations(sourceCode, filePath)
      }

      const end = performance.now()
      const avgTime = (end - start) / iterations
      const throughput = fileSize / avgTime * 1000 // chars per second

      console.log(`   ⚡ Avg time: ${avgTime.toFixed(2)}ms`)
      console.log(`   📊 Throughput: ${(throughput / 1000).toFixed(1)}k chars/sec`)
      console.log()
    }
    catch (error) {
      console.error(`❌ Error processing ${filePath}:`, error instanceof Error ? error.message : String(error))
    }
  }

  // Test with a large synthetic file
  console.log('🧪 Synthetic Large File Test')
  const largeFile = generateLargeTypeScriptFile(10000) // 10k lines

  const start = performance.now()
  const declarations = extractDeclarations(largeFile, 'synthetic.ts')
  const end = performance.now()

  console.log(`   📏 Generated ${largeFile.split('\n').length} lines`)
  console.log(`   🔍 Found ${declarations.length} declarations`)
  console.log(`   ⚡ Time: ${(end - start).toFixed(2)}ms`)
  console.log(`   📊 Throughput: ${(largeFile.length / (end - start) * 1000 / 1000).toFixed(1)}k chars/sec`)
}

function generateLargeTypeScriptFile(lines: number): string {
  const content: string[] = []

  // Add imports
  content.push('import { SomeType } from \'some-module\'')
  content.push('import type { AnotherType } from \'another-module\'')
  content.push('')

  // Add interfaces
  for (let i = 0; i < lines * 0.1; i++) {
    content.push(`export interface Interface${i} {`)
    content.push(`  prop${i}: string`)
    content.push(`  method${i}(): void`)
    content.push(`}`)
    content.push('')
  }

  // Add types
  for (let i = 0; i < lines * 0.1; i++) {
    content.push(`export type Type${i} = string | number | Interface${i}`)
  }

  // Add functions
  for (let i = 0; i < lines * 0.2; i++) {
    content.push(`export function func${i}(param: Type${i % 100}): Interface${i % 100} {`)
    content.push(`  return {} as Interface${i % 100}`)
    content.push(`}`)
    content.push('')
  }

  // Add variables
  for (let i = 0; i < lines * 0.1; i++) {
    content.push(`export const var${i}: Type${i % 100} = 'value${i}'`)
  }

  // Add classes
  for (let i = 0; i < lines * 0.1; i++) {
    content.push(`export class Class${i} implements Interface${i % 100} {`)
    content.push(`  prop${i} = 'value'`)
    content.push(`  method${i}() {}`)
    content.push(`}`)
    content.push('')
  }

  return content.join('\n')
}

// Run benchmark
benchmark().catch(console.error)

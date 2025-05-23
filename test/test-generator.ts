import { generate } from '../src/generator'
import { readFile, rm, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

// Test function extraction
async function testFunctionGeneration() {
  console.log('Testing function DTS generation...')

  // Create test input file
  const testDir = resolve(import.meta.dir, 'temp')
  const inputDir = resolve(testDir, 'input')
  const outputDir = resolve(testDir, 'output')

  // Clean up any existing test directories
  await rm(testDir, { recursive: true, force: true })
  await mkdir(inputDir, { recursive: true })

  // Create a test function file
  const testFunctionCode = `
/**
 * Test function with comments
 */
export function testFunction(name: string, age: number): string {
  return \`Hello \${name}, you are \${age} years old\`
}

export async function asyncTest(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 100))
}

// Test variables
export const stringLiteral = 'Hello World'
export const numberLiteral = 42
export const booleanLiteral = true

export let mutableString = 'can change'
export var oldStyleVar = 'old style'

// Arrays
export const numberArray = [1, 2, 3]
export const mixedArray = ['hello', 42, true]
export const nestedArray = [[1, 2], [3, 4]]

// Objects
export const simpleObject = {
  name: 'John',
  age: 30,
  active: true
}

// Complex value
export const complexObject = {
  id: 123,
  data: {
    items: [1, 2, 3],
    status: 'active'
  },
  handler: () => console.log('test')
}

// With explicit type
export const explicitType: string = 'has type'

// As const
export const asConstValue = [1, 2, 3] as const
export const asConstObject = { x: 10, y: 20 } as const
`

  await Bun.write(resolve(inputDir, 'test.ts'), testFunctionCode)

  // Run the generator
  await generate({
    cwd: testDir,
    root: './input',
    entrypoints: ['**/*.ts'],
    outdir: './output',
    outputStructure: 'mirror',
    verbose: true
  })

  // Read the generated file
  const generatedContent = await readFile(resolve(outputDir, 'test.d.ts'), 'utf-8')
  console.log('Generated content:')
  console.log(generatedContent)

  // Clean up
  await rm(testDir, { recursive: true, force: true })
}

// Run the test
testFunctionGeneration().catch(console.error)
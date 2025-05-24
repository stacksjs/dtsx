import { join } from 'node:path'
import { generate } from './src/generator'

// Test all examples
const examples = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011']

for (const example of examples) {
  console.log(`\n🔍 Testing example ${example}...`)

  const config = {
    entrypoints: [join(__dirname, `test/fixtures/input/example/${example}.ts`)],
    outdir: join(__dirname, 'test/fixtures/generated'),
    clean: false,
    tsconfigPath: join(__dirname, 'tsconfig.json'),
    outputStructure: 'flat' as const,
  }

  await generate(config)

  // Read generated and expected content
  const generatedPath = join(__dirname, 'test/fixtures/generated', `${example}.d.ts`)
  const expectedPath = join(__dirname, 'test/fixtures/output/example', `${example}.d.ts`)

  try {
    const generatedContent = await Bun.file(generatedPath).text()
    const expectedContent = await Bun.file(expectedPath).text()

    if (generatedContent === expectedContent) {
      console.log(`✅ ${example}: MATCH`)
    }
    else {
      console.log(`❌ ${example}: MISMATCH`)
      console.log(`Generated (${generatedContent.length} chars):`)
      console.log(generatedContent)
      console.log(`\nExpected (${expectedContent.length} chars):`)
      console.log(expectedContent)
      console.log(`\n${'='.repeat(80)}`)
    }
  }
  catch (error) {
    console.log(`❌ ${example}: ERROR - ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('All examples tested!')

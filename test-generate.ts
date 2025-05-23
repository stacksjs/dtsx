import { generate } from './src/generator'
import { join } from 'node:path'

const config = {
  entrypoints: [join(__dirname, 'test/fixtures/input/example/0002.ts')],
  outdir: join(__dirname, 'test/fixtures/generated'),
  clean: false,
  tsconfigPath: join(__dirname, 'tsconfig.json'),
  outputStructure: 'flat' as const,
}

console.log('Generating with config:', config)

await generate(config)

console.log('Generation complete')
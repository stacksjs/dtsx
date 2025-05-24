import path from 'node:path'
import { generate } from '../packages/dtsx/src'

console.log('Generating output...', path.join(__dirname, '..'))

generate({
  cwd: path.join(__dirname, '..'),
  root: path.join(__dirname, '..', 'test/fixtures/input'),
  outdir: path.join(__dirname, '..', 'test/fixtures/output'),
  clean: true,
  tsconfigPath: path.join(__dirname, '..', 'tsconfig.json'),
})

console.log('Generated')

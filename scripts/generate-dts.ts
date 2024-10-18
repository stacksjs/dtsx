import path from 'node:path'
import { generate } from '../src'

console.log('Generating output...', path.join(__dirname, '..'))

generate({
  cwd: path.join(__dirname, '..'),
  root: path.join(__dirname, '..', 'src'),
  outdir: path.join(__dirname, '..', 'dist'),
  clean: true,
  tsconfigPath: path.join(__dirname, '..', 'tsconfig.json'),
})

console.log('Generated')

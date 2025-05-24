import fs from 'node:fs'
import path from 'node:path'
import { generate } from '../packages/dtsx/src'

console.log('Generating output for reviewal...', path.join(__dirname, '..'))

// delete the generated directory
fs.rmdirSync(path.join(__dirname, '..', 'fixtures/generated'), { recursive: true })

generate({
  cwd: path.join(__dirname, '..'),
  root: path.join(__dirname, '..', 'fixtures/input'),
  outdir: path.join(__dirname, '..', 'fixtures/generated'),
  clean: true,
  tsconfigPath: path.join(__dirname, '..', 'tsconfig.json'),
})

console.log('Generated')

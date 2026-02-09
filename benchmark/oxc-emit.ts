/**
 * Minimal oxc-transform CLI wrapper for benchmark comparison.
 * Reads a .ts file and writes the .d.ts output using isolatedDeclarationSync.
 *
 * Usage: oxc-emit <input.ts> <output.d.ts>
 *    or: oxc-emit --project <dir> --outdir <outdir>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isolatedDeclarationSync } from 'oxc-transform'

const args = process.argv.slice(2)

if (args[0] === '--project') {
  // Multi-file mode: oxc-emit --project <dir> --outdir <outdir>
  const dir = args[1]
  const outdir = args[3]
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))

  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf-8')
    const result = isolatedDeclarationSync(file, source, { sourcemap: false })
    writeFileSync(join(outdir, file.replace(/\.ts$/, '.d.ts')), result.code)
  }
}
else {
  // Single-file mode: oxc-emit <input.ts> <output.d.ts>
  const [input, output] = args
  const source = readFileSync(input, 'utf-8')
  const result = isolatedDeclarationSync(input, source, { sourcemap: false })
  writeFileSync(output, result.code)
}

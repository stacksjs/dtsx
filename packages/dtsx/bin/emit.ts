import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { processSource } from '../src/process-source'

const args = process.argv.slice(2)
const cmd = args[0]

if (cmd === '--project') {
  // Fast project mode: dtsx --project <dir> --outdir <outdir>
  const dir = args[1]
  const outdir = args[3]
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))

  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf-8')
    const dts = processSource(source, file)
    writeFileSync(join(outdir, file.replace(/\.ts$/, '.d.ts')), dts)
  }
}
else if (cmd === 'emit' && args[1]) {
  const filePath = args[1]
  const source = readFileSync(filePath, 'utf-8')
  const outPath = args[2]
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${processSource(source, filePath)}\n`)
  }
  else {
    process.stdout.write(processSource(source, filePath))
    process.stdout.write('\n')
  }
}
else if (cmd === 'stdin' || !cmd) {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const source = Buffer.concat(chunks).toString('utf-8')
  if (source.trim()) {
    process.stdout.write(processSource(source, 'stdin.ts'))
    process.stdout.write('\n')
  }
}

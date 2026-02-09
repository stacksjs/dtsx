import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { processSource } from '../src/process-source'

const cmd = process.argv[2]

if (cmd === 'emit' && process.argv[3]) {
  const filePath = process.argv[3]
  const source = readFileSync(filePath, 'utf-8')
  const outPath = process.argv[4]
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

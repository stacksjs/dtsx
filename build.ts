import { log } from '@stacksjs/cli'

// import { $ } from 'bun'

log.info('Building...')

await Bun.build({
  entrypoints: ['./src/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
})

// tigger dts generation here

// await $`cp ./dist/src/index.js ./dist/index.js`
// await $`rm -rf ./dist/src`
// await $`cp ./dist/bin/cli.js ./dist/cli.js`
// await $`rm -rf ./dist/bin`
// await $`cp ./bin/cli.d.ts ./dist/cli.d.ts`
// await $`rm ./bin/cli.d.ts`

log.success('Built')

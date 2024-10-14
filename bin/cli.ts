import { log, CAC } from '@stacksjs/cli'
import { version } from '../package.json'
import { config } from '../src/config'
import type { DtsGenerationOption } from '../src/types'

// import { generate } from '../src/generate'

const cli = new CAC('dts')

cli
  .command('generate', 'Start the Reverse Proxy Server')
  .option('--from <from>', 'The URL to proxy from')
  .option('--verbose', 'Enable verbose logging', { default: false })
  .example('')
  .action(async (options?: DtsGenerationOption) => {
    //
  })

cli.command('version', 'Show the version of the Reverse Proxy CLI').action(() => {
  // eslint-disable-next-line no-console
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()

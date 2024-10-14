import { CAC } from '@stacksjs/cli'
import { version } from '../package.json'

// import { generate } from '../src/generate'

const cli = new CAC('dts')

cli
  .command('generate', 'Start the Reverse Proxy Server')
  .option('--from <from>', 'The URL to proxy from')
  .option('--verbose', 'Enable verbose logging', { default: false })
  .example('')
  // .action(async (options?: DtsGenerationOption) => {
  .action(async () => {
    //
  })

cli.command('version', 'Show the version of the Reverse Proxy CLI').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()

import type { CloudConfig } from '@stacksjs/ts-cloud'

/** Documentation deploys as its own tenant on the existing Stacks compute host. */
export const tsCloud: CloudConfig = {
  project: { name: 'dtsx', slug: 'dtsx', region: 'us-east-1' },
  stateDir: 'storage/cloud',
  cloud: { provider: 'hetzner', attachTo: 'stacks' },
  environments: { production: { type: 'production' } },
  sites: {
    docs: {
      deploy: 'server', root: 'dist/docs/.bunpress', domain: 'dtsx.org', path: '/',
      build: 'bunx @stacksjs/bunpress build --dir ./docs --outdir ./dist/docs',
      pathRewriteStyle: 'directory',
    },
    www: { domain: 'www.dtsx.org', redirect: 'https://dtsx.org' },
  },
}
export default {}

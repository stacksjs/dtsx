import type { Theme } from 'vitepress'
import TwoSlashFloatingVue from '@shikijs/vitepress-twoslash/client'
import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'

import 'uno.css'

import './styles/main.css'
import './styles/vars.css'
import './styles/overrides.css'

export default {
  ...DefaultTheme,

  enhanceApp(ctx: any) {
    ctx.app.use(TwoSlashFloatingVue)
  },

  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
    })
  },
} satisfies Theme

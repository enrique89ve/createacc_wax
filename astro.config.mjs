// @ts-check
import path from 'node:path'
import { defineConfig } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

import node from '@astrojs/node'
import { SITE_HOSTNAMES } from './src/consts/origins'

// https://astro.build/config
export default defineConfig({
  output: 'server',
  session: false,
  // Keep HTML-aware spaces (Astro 7 default is JSX-style strip)
  compressHTML: true,

  security: {
    checkOrigin: true,
    allowedDomains: [
      {
        hostname: SITE_HOSTNAMES.PRODUCTION,
        protocol: 'https',
      },
      {
        hostname: SITE_HOSTNAMES.SIMULATOR,
        protocol: 'https',
      },
    ],
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
  },

  adapter: node({ mode: 'standalone' }),

  i18n: {
    defaultLocale: 'en',
    locales: ['es', 'en', 'pt'],
    routing: 'manual',
  },
})


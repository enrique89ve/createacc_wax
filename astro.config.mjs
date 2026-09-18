// @ts-check
import path from 'node:path'
import { defineConfig } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

import node from '@astrojs/node'

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
        hostname: 'join.holahive.com',
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


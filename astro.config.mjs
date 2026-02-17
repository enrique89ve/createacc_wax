// @ts-check
import path from 'node:path'
import { defineConfig } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

import node from '@astrojs/node'

import auth from 'auth-astro'

// https://astro.build/config
export default defineConfig({
  output: 'server',

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

  integrations: [auth()],
})

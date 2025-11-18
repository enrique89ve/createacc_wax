// @ts-check
import path from 'node:path'
import { defineConfig } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

import vercel from '@astrojs/vercel'

import auth from 'auth-astro'

// https://astro.build/config
export default defineConfig({
  output: 'server',

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
  },

  adapter: vercel(),

  integrations: [auth()],
})

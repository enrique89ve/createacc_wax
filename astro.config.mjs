// @ts-check
import { defineConfig, envField } from 'astro/config'

import tailwindcss from '@tailwindcss/vite'

import vercel from '@astrojs/vercel'

import auth from 'auth-astro'

// https://astro.build/config
export default defineConfig({
  output: 'server',

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: vercel(),

  integrations: [auth()],
})

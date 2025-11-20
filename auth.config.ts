import { defineConfig } from 'auth-astro'
import { buildersProvider } from '@/lib/admin/auth/config/builders-provider'
import {
  jwtCallback,
  sessionCallback,
  signInCallback,
  redirectCallback,
} from '@/lib/admin/auth/config/shared-callbacks'

// Extend Auth.js types for our application
declare module '@auth/core/types' {
  interface User {
    username?: string
    role?: string
    auth_method?: string
    loginTime?: number
  }

  interface Session {
    user: {
      id: string
      username: string
      role: string
      auth_method: string
      loginTime: number
    }
  }
}

export default defineConfig({
  providers: [
    // Management login is handled via custom endpoint (/api/auth/management-login)
    // to avoid Auth.js redirect loops. See src/pages/api/auth/management-login.ts

    // Builders area provider (any Hive user with keychain auth)
    buildersProvider,
  ],

  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
    signIn: signInCallback,
    redirect: redirectCallback,
  },

  pages: {
    signIn: '/builders/login', // Default to builders login to prevent management loops
    error: '/builders/login', // Error page also goes to builders
    signOut: '/builders/login', // Redirect logout to builders login
  },

  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },

  secret: process.env.AUTH_SECRET,

  debug: process.env.NODE_ENV === 'development',
})

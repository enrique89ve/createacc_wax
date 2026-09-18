import { betterAuth } from 'better-auth'
import { LibsqlDialect } from '@libsql/kysely-libsql'
import { db } from '@/lib/database'
import { BRAND } from '@/consts/branding'
import { UserRole } from '@/lib/roles'

const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60

function resolveBaseURL(): string {
  const fromEnv = process.env.BETTER_AUTH_URL ?? process.env.AUTH_URL
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  return 'http://localhost:4321'
}

export const auth = betterAuth({
  appName: BRAND.NAME,
  baseURL: resolveBaseURL(),
  secret: process.env.AUTH_SECRET,
  database: {
    dialect: new LibsqlDialect({
      client: db,
    } as ConstructorParameters<typeof LibsqlDialect>[0]),
    type: 'sqlite',
  },
  session: {
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
    },
    expiresIn: SESSION_MAX_AGE_SECONDS,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  user: {
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      username: {
        type: 'string',
        required: true,
        input: false,
        fieldName: 'username',
      },
      role: {
        type: 'string',
        required: true,
        input: false,
        fieldName: 'role',
      },
      authMethod: {
        type: 'string',
        required: true,
        input: false,
        fieldName: 'auth_method',
      },
      isActive: {
        type: 'boolean',
        required: true,
        input: false,
        defaultValue: true,
        fieldName: 'is_active',
      },
    },
  },
  trustedOrigins: [
    'http://localhost:4321',
    'https://join.holahive.com',
    BRAND.URL,
  ],
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      sameSite: 'strict',
      httpOnly: true,
      path: '/',
    },
  },
})

export type AuthSessionUser = {
  readonly username: string
  readonly role: typeof UserRole.Admin | typeof UserRole.Builder | string
  readonly authMethod: string
  readonly isActive: boolean
  readonly name: string
  readonly email: string
  readonly id: string
}

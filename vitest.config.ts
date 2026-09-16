import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      HIVE_TX_MODE: 'simulate',
      SESSION_SECRET: 'session-secret-for-tests-32-chars-min',
      AUTH_SECRET: 'auth-secret-for-tests-32-chars-minxx',
      HIVE_CREATOR_ACCOUNT: 'creator',
      HIVE_DELEGATOR_ACCOUNT: 'delegator',
      HIVE_CREATOR_ACTIVE_KEY: '5Ktestcreator',
      HIVE_DELEGATOR_POSTING_KEY: '5Ktestdelegator',
      BEEKEEPER_WALLET_PASSWORD: 'test-wallet-password',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve('./src'),
    },
  },
})

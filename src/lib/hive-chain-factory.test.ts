import { describe, expect, it } from 'vitest'
import { BRAND } from '@/consts/branding'
import { getHiveChainOptions } from '@/lib/hive-chain-factory'

describe('getHiveChainOptions', () => {
  it('omits the WAX caller header for browser requests', () => {
    expect(getHiveChainOptions('https://api.hive.blog', false)).toEqual({
      apiEndpoint: 'https://api.hive.blog',
      apiTimeout: 5000,
    })
  })

  it('keeps the WAX caller header for server requests', () => {
    expect(getHiveChainOptions('https://api.hive.blog', true)).toEqual({
      apiEndpoint: 'https://api.hive.blog',
      apiTimeout: 5000,
      waxApiCaller: BRAND.APP_ID,
    })
  })
})

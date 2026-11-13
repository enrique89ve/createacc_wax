import { describe, expect, it } from 'vitest'
import { es } from './es'
import { applySimulationPublicCopy } from './simulation-copy'

describe('applySimulationPublicCopy', () => {
  it('replaces details checkbox with practice wording', () => {
    const merged = applySimulationPublicCopy(es)
  expect(merged.details.keysSafetyCheckbox).toBe(
      es.details.simulated!.keysSafetyCheckbox
    )
    expect(merged.details.keysSafetyCheckbox).not.toBe(
      es.details.keysSafetyCheckbox
    )
  })

  it('replaces key download keep-safe banner', () => {
    const merged = applySimulationPublicCopy(es)
    expect(merged.keys.keepSafe).toBe(es.keys.simulated!.keepSafe)
    expect(merged.keys.keepSafe).toMatch(/ENSAYO|ensayo/i)
  })
})

import { describe, expect, it } from 'vitest'
import { en } from './en'
import { es } from './es'
import { pt } from './pt'

const locales = [
  ['es', es],
  ['en', en],
  ['pt', pt],
] as const

describe('simulated public copy', () => {
  it('does not claim a Hive account exists', () => {
    for (const [locale, messages] of locales) {
      const blob = [
        messages.success.simulated.title,
        messages.success.simulated.metaDescription,
        messages.success.simulated.welcomeTitle,
        messages.success.simulated.accountCreatedLead,
        messages.success.simulated.accountCreatedTail,
        messages.success.simulated.readySubtitle,
        messages.invite.simulatedCompleted,
        messages.invite.simulatedCompletedDescription,
      ]
        .join(' ')
        .toLowerCase()

      expect(blob, locale).not.toMatch(
        /fue creada|ha sido creada|was created successfully|is now active|já está criado|foi criada com sucesso/
      )
      expect(blob, locale).toMatch(
        /no se creó|no hive account|nenhuma conta/
      )
    }
  })
})

import type { Messages } from './types'

type DetailsMessages = Messages['details']
type DetailsSimulated = NonNullable<DetailsMessages['simulated']>

function mergeDetails(
  base: DetailsMessages,
  overrides?: DetailsSimulated
): DetailsMessages {
  if (!overrides) return base
  const { creationErrors: creationErrorOverrides, ...rest } = overrides
  return {
    ...base,
    ...rest,
    ...(creationErrorOverrides
      ? {
          creationErrors: {
            ...base.creationErrors,
            ...creationErrorOverrides,
          },
        }
      : {}),
  }
}

/** Public creation-flow copy overrides when HIVE_TX_MODE is simulate. */
export function applySimulationPublicCopy(messages: Messages): Messages {
  return {
    ...messages,
    details: mergeDetails(messages.details, messages.details.simulated),
    keys: messages.keys.simulated
      ? { ...messages.keys, ...messages.keys.simulated }
      : messages.keys,
    progress: messages.progress.simulated
      ? { ...messages.progress, ...messages.progress.simulated }
      : messages.progress,
  }
}

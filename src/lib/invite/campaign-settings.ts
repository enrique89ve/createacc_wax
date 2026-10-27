import { z } from 'astro/zod'
import {
  appendAdminActionReceipt,
  findAdminActionReceipt,
  hashAdminActionCommand,
} from '@/lib/admin-action-log'
import { execute, withTransaction } from '@/lib/database'
import { Permission } from '@/lib/auth/permissions'
import type { AdminSession } from '@/types/auth'
import type { InviteCampaignSettings } from './types'

const MAX_CAMPAIGN_LIMIT = 1_000_000

const SettingsRowSchema = z.object({
  campaign_enabled: z.union([z.literal(0), z.literal(1)]),
  campaign_limit: z.number().int().nonnegative().max(MAX_CAMPAIGN_LIMIT),
  revision: z.number().int().nonnegative(),
})

const CampaignJsonSchema = z.object({
  enabled: z.boolean(),
  totalLimit: z.number().int().nonnegative().max(MAX_CAMPAIGN_LIMIT),
  issuedCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
})

const UpdateInputSchema = z.strictObject({
  enabled: z.boolean(),
  total_limit: z.number().int().min(0).max(MAX_CAMPAIGN_LIMIT),
  expected_revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  request_id: z.uuid(),
  reason: z.string().trim().min(1).max(500),
})

export class InviteCampaignSettingsError extends Error {
  constructor(
    readonly code:
      | 'INVALID_COMMAND'
      | 'STALE_REVISION'
      | 'IDEMPOTENCY_CONFLICT'
      | 'SCHEMA_UNAVAILABLE',
    message: string
  ) {
    super(message)
    this.name = 'InviteCampaignSettingsError'
  }
}

export type InviteCampaignSettingsUpdate = {
  readonly disposition: 'applied' | 'unchanged' | 'replayed'
  readonly actionLogId: number
  readonly settings: InviteCampaignSettings
}

async function readSettings(): Promise<InviteCampaignSettings> {
  const result = await execute({
    sql: 'SELECT campaign_enabled, campaign_limit, revision FROM InviteSettings WHERE singleton = 1',
    args: [],
  })
  const count = await execute({
    sql: 'SELECT COUNT(*) AS count FROM InviteGrants',
    args: [],
  })
  const parsed = SettingsRowSchema.safeParse(result.rows[0])
  const issuedCount = Number(count.rows[0]?.count)
  if (
    !parsed.success ||
    !Number.isSafeInteger(issuedCount) ||
    issuedCount < 0
  ) {
    throw new InviteCampaignSettingsError(
      'SCHEMA_UNAVAILABLE',
      'Invitation campaign settings are unavailable'
    )
  }
  return {
    enabled: parsed.data.campaign_enabled === 1,
    totalLimit: parsed.data.campaign_limit,
    issuedCount,
    revision: parsed.data.revision,
  }
}

export async function getInviteCampaignSettings(): Promise<InviteCampaignSettings> {
  return readSettings()
}

function settingsJson(settings: InviteCampaignSettings) {
  return {
    enabled: settings.enabled,
    totalLimit: settings.totalLimit,
    issuedCount: settings.issuedCount,
    revision: settings.revision,
  }
}

function parseReceiptSettings(value: unknown): InviteCampaignSettings {
  const parsed = CampaignJsonSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('Invitation campaign audit receipt is invalid')
  }
  return parsed.data
}

function isReceiptObject(value: unknown): value is {
  readonly [key: string]: import('@/lib/admin-action-log').AdminJsonValue
} {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function updateInviteCampaignSettings(
  actor: AdminSession,
  body: unknown
): Promise<InviteCampaignSettingsUpdate> {
  const parsed = UpdateInputSchema.safeParse(body)
  if (!parsed.success) {
    throw new InviteCampaignSettingsError(
      'INVALID_COMMAND',
      'Revisa los datos de la campaña e inténtalo de nuevo'
    )
  }
  const command = parsed.data
  if (command.enabled && command.total_limit === 0) {
    throw new InviteCampaignSettingsError(
      'INVALID_COMMAND',
      'Define un cupo mayor que cero antes de activar la campaña'
    )
  }
  const targetId = 'personal-invitations'
  const requestHash = hashAdminActionCommand({
    action: Permission.MANAGE_INVITE_CAMPAIGN,
    targetType: 'campaign',
    targetId,
    normalizedCommand: {
      enabled: command.enabled,
      total_limit: command.total_limit,
      expected_revision: command.expected_revision,
      reason: command.reason,
    },
  })

  return withTransaction(async () => {
    const existingReceipt = await findAdminActionReceipt({
      actorUserId: actor.userId,
      requestId: command.request_id,
    })
    if (existingReceipt) {
      if (existingReceipt.request_hash !== requestHash) {
        throw new InviteCampaignSettingsError(
          'IDEMPOTENCY_CONFLICT',
          'Este identificador ya se usó para otra solicitud'
        )
      }
      const receipt = isReceiptObject(existingReceipt.receipt)
        ? existingReceipt.receipt
        : null
      return {
        disposition: 'replayed',
        actionLogId: existingReceipt.id,
        settings: parseReceiptSettings(receipt?.settings),
      }
    }

    const before = await readSettings()
    if (before.revision !== command.expected_revision) {
      throw new InviteCampaignSettingsError(
        'STALE_REVISION',
        'La configuración cambió. Actualiza la página e inténtalo de nuevo'
      )
    }

    const unchanged =
      before.enabled === command.enabled &&
      before.totalLimit === command.total_limit
    let after: InviteCampaignSettings
    if (unchanged) {
      after = before
    } else {
      const update = await execute({
        sql: `UPDATE InviteSettings
          SET campaign_enabled = ?, campaign_limit = ?, revision = revision + 1
          WHERE singleton = 1 AND revision = ?`,
        args: [
          command.enabled ? 1 : 0,
          command.total_limit,
          command.expected_revision,
        ],
      })
      if (update.rowsAffected !== 1) {
        throw new InviteCampaignSettingsError(
          'STALE_REVISION',
          'La configuración cambió. Actualiza la página e inténtalo de nuevo'
        )
      }
      after = {
        enabled: command.enabled,
        totalLimit: command.total_limit,
        issuedCount: before.issuedCount,
        revision: before.revision + 1,
      }
    }

    const disposition = unchanged ? 'unchanged' : 'applied'
    const actionLogId = await appendAdminActionReceipt({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      requestId: command.request_id,
      action: Permission.MANAGE_INVITE_CAMPAIGN,
      targetType: 'campaign',
      targetId,
      requestHash,
      reason: command.reason,
      outcome: disposition,
      beforeState: settingsJson(before),
      afterState: settingsJson(after),
      receipt: { settings: settingsJson(after) },
    })
    return { disposition, actionLogId, settings: after }
  })
}

import { OPEN_CREATION_ATTEMPT_STATUSES } from '@/consts/hive-execution'
import { withTransaction, execute } from '@/lib/database'
import { creditsService } from '@/lib/credits-service'
import { auditRepository } from '@/lib/repositories/audit-repository'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import type { DatabaseTicketRow } from '@/types/database'

export type ArchiveOwnedTicketResult =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'open_attempts'; readonly count: number }
  | {
      readonly kind: 'archived' | 'already_archived'
      readonly ticket: DatabaseTicketRow
    }

export async function archiveOwnedTicket(
  ticketId: number,
  ownerBuilderUsername: string
): Promise<ArchiveOwnedTicketResult> {
  return withTransaction(async () => {
    const ticket = await ticketsRepository.findById(ticketId)
    if (
      !ticket ||
      ticket.funding_source !== 'builder_credits' ||
      ticket.owner_builder_username !== ownerBuilderUsername
    ) {
      return { kind: 'not_found' }
    }

    if (ticket.archived_at !== null) {
      return { kind: 'already_archived', ticket }
    }

    const openAttemptCount = await execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM CreationAttempts
        WHERE ticket_id = ? AND status IN (${OPEN_CREATION_ATTEMPT_STATUSES.map(() => '?').join(', ')})
      `,
      args: [ticket.id, ...OPEN_CREATION_ATTEMPT_STATUSES],
    })
    const count = Number(openAttemptCount.rows[0]?.count ?? 0)
    if (count > 0) return { kind: 'open_attempts', count }

    const archived = await ticketsRepository.archiveOwned(
      ticket.id,
      ownerBuilderUsername
    )
    if (!archived) {
      const current = await ticketsRepository.findById(ticket.id)
      return current?.archived_at
        ? { kind: 'already_archived', ticket: current }
        : { kind: 'not_found' }
    }

    if (archived.retired_uses > 0) {
      await creditsService.refundCreditsFromTicket(
        ownerBuilderUsername,
        archived.retired_uses,
        archived.code,
        `ticket:${archived.id}:archive-refund`
      )
    }
    await auditRepository.createTicketLog({
      ticketId: archived.id,
      ticket: archived.code,
      action: 'archived',
      actorType: 'builder',
      actorId: ownerBuilderUsername,
      delta: -archived.retired_uses,
      beforeUses: ticket.remaining_uses,
      afterUses: 0,
      beforeState: {
        archivedAt: null,
        remainingUses: ticket.remaining_uses,
        retiredUses: ticket.retired_uses,
      },
      afterState: {
        archivedAt: archived.archived_at,
        remainingUses: archived.remaining_uses,
        retiredUses: archived.retired_uses,
      },
      operationReference: `ticket:${archived.id}:archive`,
    })

    return { kind: 'archived', ticket: archived }
  })
}

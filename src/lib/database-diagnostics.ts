import {
  databaseConfiguration,
  execute,
  withReadSnapshot,
} from '@/lib/database'

export type DatabaseDiagnosticSeverity = 'critical' | 'warning'

export interface DatabaseDiagnosticIssue {
  readonly severity: DatabaseDiagnosticSeverity
  readonly code: string
  readonly entity: 'credit' | 'ticket' | 'attempt' | 'account' | 'audit'
  readonly reference: string
  readonly detail: string
}

export interface DatabaseDiagnosticReport {
  readonly generatedAt: string
  readonly databaseMode: string
  readonly issueCount: number
  readonly criticalCount: number
  readonly issues: readonly DatabaseDiagnosticIssue[]
}

type Row = Record<string, unknown>

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function issue(
  issues: DatabaseDiagnosticIssue[],
  code: string,
  entity: DatabaseDiagnosticIssue['entity'],
  reference: string,
  detail: string,
  severity: DatabaseDiagnosticSeverity = 'critical'
): void {
  issues.push({ severity, code, entity, reference, detail })
}

async function rows(
  sql: string,
  args: readonly (string | number | null)[] = []
): Promise<Row[]> {
  const result = await execute({ sql, args: [...args] })
  return result.rows as Row[]
}

async function diagnoseCredits(
  issues: DatabaseDiagnosticIssue[]
): Promise<void> {
  const balances = await rows(`
    SELECT c.hive_username, c.pending_amount, c.available_amount,
           c.total_issued, c.total_consumed,
           COALESCE(a.assigned, 0) AS assigned,
           COALESCE(a.granted_available, 0) AS granted_available,
           COALESCE(a.claimed, 0) AS claimed,
           COALESCE(a.ticket_spend, 0) AS ticket_spend,
           COALESCE(a.ticket_refund, 0) AS ticket_refund,
           COALESCE(a.consumed, 0) AS consumed,
           COALESCE(a.admin_adjustment, 0) AS admin_adjustment,
           COALESCE(a.admin_pending, 0) AS admin_pending,
           COALESCE(a.transfer_in, 0) AS transfer_in,
           COALESCE(a.transfer_out, 0) AS transfer_out
    FROM Credits c
    LEFT JOIN (
      SELECT hive_username,
        SUM(CASE WHEN operation = 'assign_credits' THEN amount ELSE 0 END) assigned,
        SUM(CASE WHEN operation = 'grant_available_credits' THEN amount ELSE 0 END) granted_available,
        SUM(CASE WHEN operation IN ('claim_credits', 'claim_via_blockchain') THEN amount ELSE 0 END) claimed,
        SUM(CASE WHEN operation = 'create_ticket' THEN amount ELSE 0 END) ticket_spend,
        SUM(CASE WHEN operation = 'delete_ticket_refund' THEN amount ELSE 0 END) ticket_refund,
        SUM(CASE WHEN operation = 'consume_credits' THEN amount ELSE 0 END) consumed,
        SUM(CASE WHEN operation = 'admin_adjustment' THEN amount ELSE 0 END) admin_adjustment,
        SUM(CASE WHEN operation = 'admin_adjust_pending' THEN amount ELSE 0 END) admin_pending,
        SUM(CASE WHEN operation = 'transfer_in' THEN amount ELSE 0 END) transfer_in,
        SUM(CASE WHEN operation = 'transfer_out' THEN amount ELSE 0 END) transfer_out
      FROM CreditAudit GROUP BY hive_username
    ) a ON a.hive_username = c.hive_username
    ORDER BY c.hive_username
  `)

  for (const row of balances) {
    const username = stringValue(row.hive_username)
    const pendingExpected =
      numeric(row.assigned) + numeric(row.admin_pending) - numeric(row.claimed)
    const availableExpected =
      numeric(row.claimed) +
      numeric(row.granted_available) +
      numeric(row.ticket_spend) +
      numeric(row.ticket_refund) +
      numeric(row.admin_adjustment) +
      numeric(row.transfer_in) +
      numeric(row.transfer_out)
    const issuedExpected =
      numeric(row.assigned) + numeric(row.granted_available)
    const consumedExpected = -numeric(row.consumed)

    for (const [field, expected] of [
      ['pending_amount', pendingExpected],
      ['available_amount', availableExpected],
      ['total_issued', issuedExpected],
      ['total_consumed', consumedExpected],
    ] as const) {
      const actual = numeric(row[field])
      if (actual !== expected) {
        issue(
          issues,
          `credit_${field}_ledger_mismatch`,
          'credit',
          username,
          `${field}: ledger=${expected}, stored=${actual}`
        )
      }
    }
  }

  for (const row of await rows(`
    SELECT DISTINCT a.hive_username FROM CreditAudit a
    LEFT JOIN Credits c ON c.hive_username = a.hive_username
    WHERE c.hive_username IS NULL ORDER BY a.hive_username
  `)) {
    const username = stringValue(row.hive_username)
    issue(
      issues,
      'credit_audit_without_balance',
      'credit',
      username,
      'CreditAudit entries exist without a Credits balance row'
    )
  }

  for (const row of await rows(`
    SELECT u.hive_username,
           COALESCE(a.account_count, 0) AS account_count,
           COALESCE(c.total_consumed, 0) AS total_consumed,
           COALESCE(-l.consumed_amount, 0) AS ledger_consumed
    FROM (
      SELECT hive_username FROM Credits
      UNION
      SELECT builder_username AS hive_username FROM Accounts
        WHERE builder_username IS NOT NULL
      UNION
      SELECT hive_username FROM CreditAudit WHERE operation = 'consume_credits'
    ) u
    LEFT JOIN Credits c ON c.hive_username = u.hive_username
    LEFT JOIN (
      SELECT builder_username, COUNT(*) account_count FROM Accounts
      WHERE builder_username IS NOT NULL GROUP BY builder_username
    ) a ON a.builder_username = u.hive_username
    LEFT JOIN (
      SELECT hive_username, SUM(amount) consumed_amount
      FROM CreditAudit WHERE operation = 'consume_credits'
      GROUP BY hive_username
    ) l ON l.hive_username = u.hive_username
    ORDER BY u.hive_username
  `)) {
    const username = stringValue(row.hive_username)
    const accounts = numeric(row.account_count)
    const totalConsumed = numeric(row.total_consumed)
    const ledgerConsumed = numeric(row.ledger_consumed)
    if (totalConsumed !== accounts) {
      issue(
        issues,
        'builder_consumed_account_mismatch',
        'credit',
        username,
        `total_consumed=${totalConsumed}, builder-funded accounts=${accounts}`
      )
    }
    if (ledgerConsumed !== accounts) {
      issue(
        issues,
        'builder_consumption_ledger_mismatch',
        'credit',
        username,
        `consume_credits ledger=${ledgerConsumed}, builder-funded accounts=${accounts}`
      )
    }
  }
}

async function diagnoseTickets(
  issues: DatabaseDiagnosticIssue[]
): Promise<void> {
  for (const row of await rows(`
    SELECT t.id, t.code, t.total_uses, t.remaining_uses, t.retired_uses,
           COALESCE(a.account_count, 0) account_count,
           COALESCE(p.open_count, 0) open_count
    FROM Tickets t
    LEFT JOIN (
      SELECT ticket_id, COUNT(*) account_count FROM Accounts GROUP BY ticket_id
    ) a ON a.ticket_id = t.id
    LEFT JOIN (
      SELECT ticket_id, COUNT(*) open_count FROM CreationAttempts
      WHERE status IN ('reserved', 'prepared', 'broadcasting') GROUP BY ticket_id
    ) p ON p.ticket_id = t.id
    ORDER BY t.id
  `)) {
    const code = stringValue(row.code)
    const total = numeric(row.total_uses)
    const accounted =
      numeric(row.remaining_uses) +
      numeric(row.open_count) +
      numeric(row.account_count) +
      numeric(row.retired_uses)
    if (total !== accounted) {
      issue(
        issues,
        'ticket_use_conservation_mismatch',
        'ticket',
        `${numeric(row.id)}:${code}`,
        `total=${total}, remaining=${numeric(row.remaining_uses)}, open reservations=${numeric(row.open_count)}, accounts=${numeric(row.account_count)}, retired=${numeric(row.retired_uses)}`
      )
    }
  }

  for (const row of await rows(`
    SELECT a.id, a.username, a.ticket, a.ticket_id, a.builder_username,
           t.code, t.funding_source, t.owner_builder_username
    FROM Accounts a JOIN Tickets t ON t.id = a.ticket_id
    WHERE a.ticket != t.code
       OR (t.funding_source = 'system' AND a.builder_username IS NOT NULL)
       OR (t.funding_source = 'builder_credits' AND a.builder_username IS NOT t.owner_builder_username)
  `)) {
    issue(
      issues,
      'account_ticket_funding_mismatch',
      'account',
      stringValue(row.username),
      `account ticket=${stringValue(row.ticket)}#${numeric(row.ticket_id)}, actual=${stringValue(row.code)}; funding=${stringValue(row.funding_source)}, owner=${stringValue(row.owner_builder_username)}`
    )
  }

  for (const row of await rows(`
    SELECT id, code, owner_builder_username, retired_uses
    FROM Tickets WHERE funding_source = 'builder_credits'
      AND archived_at IS NOT NULL AND retired_uses > 0
  `)) {
    const ticketId = numeric(row.id)
    const owner = stringValue(row.owner_builder_username)
    const reference = `ticket:${ticketId}:archive-refund`
    const refund = (
      await rows(
        `
      SELECT hive_username, amount, operation FROM CreditAudit
      WHERE external_reference = ?
    `,
        [reference]
      )
    )[0]
    if (
      !refund ||
      refund.operation !== 'delete_ticket_refund' ||
      stringValue(refund.hive_username) !== owner ||
      numeric(refund.amount) !== numeric(row.retired_uses)
    ) {
      issue(
        issues,
        'ticket_archive_refund_mismatch',
        'ticket',
        `${ticketId}:${stringValue(row.code)}`,
        `expected refund=${numeric(row.retired_uses)} to ${owner} at ${reference}`
      )
    }
  }

  for (const row of await rows(`
    SELECT ta.ticket_id, ta.operation_reference, ta.actor_id, ta.delta,
           ca.hive_username, ca.operation, ca.amount
    FROM TicketAudit ta
    LEFT JOIN CreditAudit ca ON ca.external_reference = ta.operation_reference
    WHERE ta.action = 'uses_adjusted' AND COALESCE(ta.delta, 0) != 0
  `)) {
    const delta = numeric(row.delta)
    const expectedOperation =
      delta > 0 ? 'create_ticket' : 'delete_ticket_refund'
    const expectedAmount = -delta
    if (
      row.operation !== expectedOperation ||
      numeric(row.amount) !== expectedAmount ||
      stringValue(row.hive_username) !== stringValue(row.actor_id)
    ) {
      issue(
        issues,
        'ticket_uses_credit_audit_mismatch',
        'audit',
        stringValue(row.operation_reference),
        `ticket=${numeric(row.ticket_id)}, delta=${delta}, expected ${expectedOperation} amount=${expectedAmount} for ${stringValue(row.actor_id)}`
      )
    }
  }

  for (const row of await rows(`
    SELECT ta.ticket_id, ta.operation_reference,
           t.owner_builder_username, t.total_uses,
           ca.hive_username, ca.operation, ca.amount
    FROM TicketAudit ta
    JOIN Tickets t ON t.id = ta.ticket_id
    LEFT JOIN CreditAudit ca ON ca.external_reference = ta.operation_reference
    WHERE ta.action = 'create' AND t.funding_source = 'builder_credits'
  `)) {
    if (
      row.operation !== 'create_ticket' ||
      numeric(row.amount) !== -numeric(row.total_uses) ||
      stringValue(row.hive_username) !== stringValue(row.owner_builder_username)
    ) {
      issue(
        issues,
        'ticket_creation_credit_audit_mismatch',
        'audit',
        stringValue(row.operation_reference),
        `ticket=${numeric(row.ticket_id)}, expected create_ticket amount=${-numeric(row.total_uses)} for ${stringValue(row.owner_builder_username)}`
      )
    }
  }
}

async function diagnoseAttempts(
  issues: DatabaseDiagnosticIssue[]
): Promise<void> {
  for (const row of await rows(`
    SELECT a.correlation_id, a.username, a.ticket, a.ticket_id,
           a.funding_source, a.owner_builder_username,
           t.code, t.funding_source AS actual_funding_source,
           t.owner_builder_username AS actual_owner
    FROM CreationAttempts a JOIN Tickets t ON t.id = a.ticket_id
    WHERE a.ticket != t.code OR a.funding_source != t.funding_source
       OR a.owner_builder_username IS NOT t.owner_builder_username
  `)) {
    issue(
      issues,
      'attempt_ticket_snapshot_mismatch',
      'attempt',
      stringValue(row.correlation_id),
      `attempt ticket=${stringValue(row.ticket)}#${numeric(row.ticket_id)}, current=${stringValue(row.code)}; funding=${stringValue(row.funding_source)}, current funding=${stringValue(row.actual_funding_source)}`
    )
  }

  for (const row of await rows(`
    SELECT a.correlation_id, a.username, a.ticket_id, a.owner_builder_username,
           a.transaction_id, a.status,
           (SELECT COUNT(*) FROM Accounts ac WHERE ac.correlation_id = a.correlation_id) account_count,
           (SELECT COUNT(*) FROM Accounts ac WHERE ac.correlation_id = a.correlation_id
             AND ac.username = a.username AND ac.ticket_id = a.ticket_id) matching_account_count,
           (SELECT COUNT(*) FROM CreationAttemptEvents e WHERE e.correlation_id = a.correlation_id
             AND e.event_type = CASE a.status WHEN 'completed' THEN 'completed' ELSE 'rolled_back' END
             AND e.to_status = a.status) terminal_event_count,
           (SELECT COUNT(*) FROM CreditAudit ca WHERE ca.external_reference = 'creation:' || a.correlation_id || ':consume'
             AND ca.operation = 'consume_credits' AND ca.amount = -1
             AND ca.hive_username = a.owner_builder_username) consume_event_count
    FROM CreationAttempts a WHERE a.status IN ('completed', 'rolled_back')
  `)) {
    const correlationId = stringValue(row.correlation_id)
    const status = stringValue(row.status)
    const accountCount = numeric(row.account_count)
    const matchingAccountCount = numeric(row.matching_account_count)
    const terminalEvents = numeric(row.terminal_event_count)
    const consumeEvents = numeric(row.consume_event_count)
    if (
      status === 'completed' &&
      (accountCount !== 1 || matchingAccountCount !== 1)
    ) {
      issue(
        issues,
        'completed_attempt_account_mismatch',
        'attempt',
        correlationId,
        `completed attempt has ${accountCount} linked account rows and ${matchingAccountCount} identity-matching rows`
      )
    }
    if (status === 'rolled_back' && accountCount !== 0) {
      issue(
        issues,
        'rolled_back_attempt_has_account',
        'attempt',
        correlationId,
        `rolled-back attempt has ${accountCount} linked account rows`
      )
    }
    if (terminalEvents !== 1) {
      issue(
        issues,
        'attempt_terminal_event_mismatch',
        'attempt',
        correlationId,
        `${status} attempt has ${terminalEvents} matching terminal events`
      )
    }
    const expectedConsumeEvents =
      status === 'completed' && row.owner_builder_username !== null ? 1 : 0
    if (consumeEvents !== expectedConsumeEvents) {
      issue(
        issues,
        'attempt_credit_consumption_reference_mismatch',
        'attempt',
        correlationId,
        `${status} attempt has ${consumeEvents} linked Builder consumption events; expected ${expectedConsumeEvents}`
      )
    }
  }
}

export async function diagnoseDatabaseConsistency(): Promise<DatabaseDiagnosticReport> {
  return withReadSnapshot(async () => {
    const issues: DatabaseDiagnosticIssue[] = []
    await diagnoseCredits(issues)
    await diagnoseTickets(issues)
    await diagnoseAttempts(issues)
    return {
      generatedAt: new Date().toISOString(),
      databaseMode: databaseConfiguration.mode,
      issueCount: issues.length,
      criticalCount: issues.filter(item => item.severity === 'critical').length,
      issues,
    }
  })
}

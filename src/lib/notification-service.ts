import { execute } from './database'
import { logger } from '@/lib/logger'
import type {
  CreateNotificationData,
  DatabaseNotificationRow,
} from '@/types/database'
import { parseNotificationRow as parseRow } from '@/types/database'

export async function getUnreadCount(hiveUsername: string): Promise<number> {
  try {
    const result = await execute({
      sql: `
				SELECT COUNT(*) as count
				FROM Notifications
				WHERE hive_username = ? AND is_read = FALSE
			`,
      args: [hiveUsername],
    })

    const row = result.rows[0] as unknown as { count: number }
    return row?.count ?? 0
  } catch (error) {
    logger.error('Error getting unread notification count:', error)
    return 0
  }
}

export async function getNotifications(
  hiveUsername: string,
  limit = 10
): Promise<DatabaseNotificationRow[]> {
  try {
    const result = await execute({
      sql: `
				SELECT id, hive_username, type, title, message, metadata, is_read, created_at, read_at, viewed_at
				FROM Notifications
				WHERE hive_username = ?
				ORDER BY is_read ASC, created_at DESC
				LIMIT ?
			`,
      args: [hiveUsername, limit],
    })

    return result.rows
      .map(parseRow)
      .filter((n): n is DatabaseNotificationRow => n !== null)
  } catch (error) {
    logger.error('Error getting notifications:', error)
    return []
  }
}

export async function getUnreadNotifications(
  hiveUsername: string
): Promise<DatabaseNotificationRow[]> {
  try {
    const result = await execute({
      sql: `
				SELECT id, hive_username, type, title, message, metadata, is_read, created_at, read_at, viewed_at
				FROM Notifications
				WHERE hive_username = ? AND is_read = FALSE
				ORDER BY created_at DESC
			`,
      args: [hiveUsername],
    })

    return result.rows
      .map(parseRow)
      .filter((n): n is DatabaseNotificationRow => n !== null)
  } catch (error) {
    logger.error('Error getting unread notifications:', error)
    return []
  }
}

export async function createNotification(
  data: CreateNotificationData
): Promise<boolean> {
  try {
    await execute({
      sql: `
				INSERT INTO Notifications (hive_username, type, title, message, metadata)
				VALUES (?, ?, ?, ?, ?)
			`,
      args: [
        data.hive_username,
        data.type,
        data.title,
        data.message,
        data.metadata ?? null,
      ],
    })
    return true
  } catch (error) {
    logger.error('Error creating notification:', error)
    return false
  }
}

export async function markAsRead(
  notificationId: number,
  hiveUsername: string
): Promise<boolean> {
  try {
    const result = await execute({
      sql: `
				UPDATE Notifications
				SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
				WHERE id = ? AND hive_username = ?
			`,
      args: [notificationId, hiveUsername],
    })
    return result.rowsAffected > 0
  } catch (error) {
    logger.error('Error marking notification as read:', error)
    return false
  }
}

export async function markAllAsRead(hiveUsername: string): Promise<boolean> {
  try {
    await execute({
      sql: `
				UPDATE Notifications
				SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
				WHERE hive_username = ? AND is_read = FALSE
			`,
      args: [hiveUsername],
    })
    return true
  } catch (error) {
    logger.error('Error marking all notifications as read:', error)
    return false
  }
}

export async function notifyPendingCredits(
  hiveUsername: string,
  amount: number
): Promise<boolean> {
  return createNotification({
    hive_username: hiveUsername,
    type: 'pending_credits',
    title: 'Pending Credits',
    message: `You have ${amount} ${amount === 1 ? 'credit' : 'credits'} to claim`,
    metadata: JSON.stringify({ amount }),
  })
}

export async function notifyCreditAssigned(
  hiveUsername: string,
  amount: number,
  assignedBy?: string
): Promise<boolean> {
  const message = assignedBy
    ? `You have been assigned ${amount} ${amount === 1 ? 'credit' : 'credits'} by ${assignedBy}`
    : `You have been assigned ${amount} ${amount === 1 ? 'credit' : 'credits'}`

  return createNotification({
    hive_username: hiveUsername,
    type: 'credit_assigned',
    title: 'Assigned Credits',
    message,
    metadata: JSON.stringify({ amount, assignedBy }),
  })
}

export async function notifyAccountCreated(
  hiveUsername: string,
  accountUsername: string,
  ticketCode: string
): Promise<boolean> {
  return createNotification({
    hive_username: hiveUsername,
    type: 'account_created',
    title: 'Cuenta Creada',
    message: `Se creó la cuenta @${accountUsername} usando tu ticket`,
    metadata: JSON.stringify({
      account_username: accountUsername,
      ticket_code: ticketCode,
    }),
  })
}

export async function markAsViewed(hiveUsername: string): Promise<boolean> {
  try {
    await execute({
      sql: `
				UPDATE Notifications
				SET viewed_at = CURRENT_TIMESTAMP
				WHERE hive_username = ? AND viewed_at IS NULL
			`,
      args: [hiveUsername],
    })
    return true
  } catch (error) {
    logger.error('Error marking notifications as viewed:', error)
    return false
  }
}

/**
 * Notification Service - Manages user notifications
 * Handles creation, retrieval, and marking notifications as read
 */

import { db } from './database'
import type {
	CreateNotificationData,
	DatabaseNotificationRow,
} from '@/types/database'
import { parseNotificationRow as parseRow } from '@/types/database'

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: number): Promise<number> {
	try {
		const result = await db.execute({
			sql: `
				SELECT COUNT(*) as count
				FROM Notifications
				WHERE user_id = ? AND is_read = FALSE
			`,
			args: [userId],
		})

		const row = result.rows[0] as unknown as { count: number }
		return row?.count ?? 0
	} catch (error) {
		console.error('Error getting unread notification count:', error)
		return 0
	}
}

/**
 * Get all notifications for a user (unread first, then read)
 */
export async function getNotifications(
	userId: number,
	limit: number = 10
): Promise<DatabaseNotificationRow[]> {
	try {
		const result = await db.execute({
			sql: `
				SELECT id, user_id, type, title, message, metadata, is_read, created_at, read_at, viewed_at
				FROM Notifications
				WHERE user_id = ?
				ORDER BY is_read ASC, created_at DESC
				LIMIT ?
			`,
			args: [userId, limit],
		})

		return result.rows.map(parseRow).filter((n): n is DatabaseNotificationRow => n !== null)
	} catch (error) {
		console.error('Error getting notifications:', error)
		return []
	}
}

/**
 * Get only unread notifications for a user
 */
export async function getUnreadNotifications(
	userId: number
): Promise<DatabaseNotificationRow[]> {
	try {
		const result = await db.execute({
			sql: `
				SELECT id, user_id, type, title, message, metadata, is_read, created_at, read_at, viewed_at
				FROM Notifications
				WHERE user_id = ? AND is_read = FALSE
				ORDER BY created_at DESC
			`,
			args: [userId],
		})

		return result.rows.map(parseRow).filter((n): n is DatabaseNotificationRow => n !== null)
	} catch (error) {
		console.error('Error getting unread notifications:', error)
		return []
	}
}

/**
 * Create a new notification
 */
export async function createNotification(
	data: CreateNotificationData
): Promise<boolean> {
	try {
		await db.execute({
			sql: `
				INSERT INTO Notifications (user_id, type, title, message, metadata)
				VALUES (?, ?, ?, ?, ?)
			`,
			args: [
				data.user_id,
				data.type,
				data.title,
				data.message,
				data.metadata ?? null,
			],
		})

		return true
	} catch (error) {
		console.error('Error creating notification:', error)
		return false
	}
}

/**
 * Mark a notification as read
 */
export async function markAsRead(
	notificationId: number,
	userId: number
): Promise<boolean> {
	try {
		const result = await db.execute({
			sql: `
				UPDATE Notifications
				SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
				WHERE id = ? AND user_id = ?
			`,
			args: [notificationId, userId],
		})

		return result.rowsAffected > 0
	} catch (error) {
		console.error('Error marking notification as read:', error)
		return false
	}
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: number): Promise<boolean> {
	try {
		await db.execute({
			sql: `
				UPDATE Notifications
				SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
				WHERE user_id = ? AND is_read = FALSE
			`,
			args: [userId],
		})

		return true
	} catch (error) {
		console.error('Error marking all notifications as read:', error)
		return false
	}
}

/**
 * Create notification for pending credits
 */
export async function notifyPendingCredits(
	userId: number,
	amount: number
): Promise<boolean> {
	return createNotification({
		user_id: userId,
		type: 'pending_credits',
		title: 'Créditos Pendientes',
		message: `Tienes ${amount} ${amount === 1 ? 'crédito' : 'créditos'} por reclamar`,
		metadata: JSON.stringify({ amount }),
	})
}

/**
 * Create notification for credit assignment
 */
export async function notifyCreditAssigned(
	userId: number,
	amount: number,
	assignedBy?: string
): Promise<boolean> {
	const message = assignedBy
		? `Se te han asignado ${amount} ${amount === 1 ? 'crédito' : 'créditos'} por ${assignedBy}`
		: `Se te han asignado ${amount} ${amount === 1 ? 'crédito' : 'créditos'}`

	return createNotification({
		user_id: userId,
		type: 'credit_assigned',
		title: 'Créditos Asignados',
		message,
		metadata: JSON.stringify({ amount, assignedBy }),
	})
}

/**
 * Mark all un-viewed notifications as viewed for a user
 * This is called when the user opens the notification modal
 */
export async function markAsViewed(userId: number): Promise<boolean> {
	try {
		await db.execute({
			sql: `
				UPDATE Notifications
				SET viewed_at = CURRENT_TIMESTAMP
				WHERE user_id = ? AND viewed_at IS NULL
			`,
			args: [userId],
		})

		return true
	} catch (error) {
		console.error('Error marking notifications as viewed:', error)
		return false
	}
}

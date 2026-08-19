import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { usersRepository } from '@/lib/repositories/users-repository'
import {
	assertCanPerform,
	unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { parseClientUserRef, signUserId } from '@/lib/user-id-token'
import { UserRole } from '@/lib/roles'
import { db } from '@/lib/database'

function builderIdFromParams(raw: string | undefined): string | null {
	return parseClientUserRef(raw)
}

export const PATCH: APIRoute = async context => {
	return withAdminSession(context, async session => {
		try {
			assertCanPerform(session, 'MANAGE_BUILDERS', 'PATCH /api/management/users/[id]')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const builderId = builderIdFromParams(context.params.id)
			if (!builderId) {
				return apiError('ID de builder inválido', 400)
			}

			const data = await context.request.json()
			const isActive = (data as { is_active?: unknown }).is_active
			if (typeof isActive !== 'boolean') {
				return apiError('is_active debe ser booleano', 400)
			}

			const builder = await usersRepository.getById(builderId)
			if (!builder || builder.role !== UserRole.Builder) {
				return apiError('Builder no encontrado', 404)
			}

			await db.execute({
				sql: 'UPDATE "user" SET is_active = ? WHERE id = ? AND role = \'builder\'',
				args: [isActive, builderId],
			})

			return apiSuccess({
				message: 'Builder actualizado exitosamente',
				user: {
					id: signUserId(builderId),
					hive_username: builder.username,
					is_active: isActive,
				},
			})
		} catch {
			return apiError('Error interno', 500)
		}
	})
}

export const DELETE: APIRoute = async context => {
	return withAdminSession(context, async session => {
		try {
			assertCanPerform(session, 'DELETE_BUILDER', 'DELETE /api/management/users/[id]')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const userId = builderIdFromParams(context.params.id)
			if (!userId) {
				return apiError('ID de usuario inválido', 400)
			}

			const builder = await usersRepository.findById(userId)
			if (!builder || builder.role !== UserRole.Builder) {
				return apiError('Builder no encontrado', 404)
			}

			await usersRepository.deleteBuilderWithReferences(userId)

			return apiSuccess({
				message: 'Usuario eliminado exitosamente',
			})
		} catch {
			return apiError('Error interno', 500)
		}
	})
}

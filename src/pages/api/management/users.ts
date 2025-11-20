import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { usersRepository } from '@/lib/repositories/users-repository'
import { creditsService } from '@/lib/credits-service'
import {
  assertCanPerform,
  unauthorizedResponse,
} from '@/lib/admin/permissions-management'

// GET: Listar usuarios builders
export const GET: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          'MANAGE_BUILDERS',
          'GET /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      // Obtener todos los builders usando el unified repository
      const builders = await usersRepository.getAllBuilders()

      const users = builders.map(builder => ({
        id: builder.id,
        username: builder.hive_username,
        role: 'builder' as const,
        is_active: builder.is_active,
        last_claim_at: builder.last_claim_at,
        created_at: builder.created_at,
      }))

      return new Response(JSON.stringify({ success: true, users }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Error interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })
}

// POST: Crear nuevo usuario builder
export const POST: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          'CREATE_BUILDER',
          'POST /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      const data = await context.request.json()
      interface BuilderCreateRequest {
        readonly hive_username?: string
      }

      const { hive_username, amount } = data as BuilderCreateRequest & {
        amount?: number
      }

      if (!hive_username || hive_username.length < 3) {
        return new Response(
          JSON.stringify({
            error: 'Hive username debe tener al menos 3 caracteres',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      const cleanUsername = hive_username.trim().toLowerCase()
      const initialCredits =
        typeof amount === 'number' && amount > 0 ? amount : 100

      // Verificar que el builder no exista usando el unified repository
      const exists =
        await usersRepository.builderExistsByUsername(cleanUsername)

      if (exists) {
        return new Response(JSON.stringify({ error: 'El builder ya existe' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Crear builder usando the unified repository
      const newUser = await usersRepository.create({
        username: cleanUsername,
        role: 'builder',
        is_active: true,
      })

      const builderId = newUser.id

      // Asignar créditos iniciales usando el creditsService
      await creditsService.assignCredits({
        hive_username: cleanUsername,
        amount: initialCredits,
        source: 'Créditos iniciales al crear builder',
        assigned_by_admin: session.userId,
      })

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Builder creado exitosamente con 100 créditos pendientes',
          user: {
            id: builderId,
            hive_username: cleanUsername,
            role: 'builder',
            initial_credits: 100,
          },
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return new Response(JSON.stringify({ error: 'El builder ya existe' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'Error interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })
}

// DELETE: Eliminar usuario builder
export const DELETE: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          'DELETE_BUILDER',
          'DELETE /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      const url = new URL(context.request.url)
      const userId = url.searchParams.get('id')

      if (!userId || !Number.isInteger(Number(userId))) {
        return new Response(
          JSON.stringify({ error: 'ID de usuario inválido' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Verificar que el builder existe usando the unified repository
      const user = await usersRepository.findById(Number(userId))

      if (!user || user.role !== 'builder') {
        return new Response(
          JSON.stringify({ error: 'Builder no encontrado' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Eliminar builder y limpiar dependencias
      await usersRepository.deleteBuilderWithReferences(Number(userId))

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Usuario eliminado exitosamente',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Error interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })
}

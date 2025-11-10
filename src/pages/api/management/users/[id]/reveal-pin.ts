import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'

// POST: Revelar PIN de un builder (solo para admins)
export const POST: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      // Solo admin puede revelar PINs
      if (session.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { id } = context.params
      const userId = Number(id)

      if (!Number.isInteger(userId)) {
        return new Response(
          JSON.stringify({ error: 'ID de usuario inválido' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Verificar que el builder existe
      const builderResult = await db.execute({
        sql: 'SELECT id, hive_username FROM Builders WHERE id = ?',
        args: [userId],
      })

      if (builderResult.rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Builder no encontrado' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const user = userResult.rows[0] as any

      // Mensaje indicando que el PIN está hasheado y no se puede revelar
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Los PINs están encriptados por seguridad y no se pueden revelar.',
          note: 'Si necesitas generar un nuevo PIN, elimina y crea nuevamente el builder.',
          user: {
            id: userId,
            username: user.username,
          },
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
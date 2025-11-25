/**
 * Script para generar notificaciones de créditos pendientes retroactivas
 * Se ejecuta una sola vez para crear notificaciones para builders con pending_amount > 0
 */

import { db } from '@/lib/database'
import { notifyPendingCredits } from '@/lib/notification-service'

async function generatePendingNotifications() {
  console.log('🔄 Generando notificaciones de créditos pendientes...\n')

  try {
    // Buscar builders con créditos pendientes
    const buildersWithPending = await db.execute({
      sql: `
        SELECT
          u.id,
          u.username,
          c.pending_amount
        FROM Users u
        INNER JOIN Credits c ON c.builder_id = u.id
        WHERE u.role = 'builder'
          AND c.pending_amount > 0
      `,
      args: [],
    })

    console.log(`📊 Builders con créditos pendientes: ${buildersWithPending.rows.length}\n`)

    if (buildersWithPending.rows.length === 0) {
      console.log('✅ No hay builders con créditos pendientes.')
      return
    }

    let created = 0
    let skipped = 0

    for (const row of buildersWithPending.rows) {
      const builderId = (row as any).id
      const username = (row as any).username
      const pendingAmount = (row as any).pending_amount

      // Verificar si ya existe notificación de pending_credits sin leer
      const existing = await db.execute({
        sql: `
          SELECT id FROM Notifications
          WHERE user_id = ?
            AND type = 'pending_credits'
            AND is_read = FALSE
        `,
        args: [builderId],
      })

      if (existing.rows.length > 0) {
        console.log(`⏭️  ${username}: Ya tiene notificación de pending_credits (skipped)`)
        skipped++
        continue
      }

      // Crear notificación
      const success = await notifyPendingCredits(builderId, pendingAmount)

      if (success) {
        console.log(`✅ ${username}: Notificación creada (${pendingAmount} créditos)`)
        created++
      } else {
        console.log(`❌ ${username}: Error al crear notificación`)
      }
    }

    console.log(`\n📈 Resumen:`)
    console.log(`   Creadas: ${created}`)
    console.log(`   Omitidas: ${skipped}`)
    console.log(`   Total: ${buildersWithPending.rows.length}`)
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

generatePendingNotifications()

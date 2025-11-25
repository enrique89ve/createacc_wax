/**
 * Script de diagnóstico para verificar notificaciones
 */

import { db } from '@/lib/database'
import { UsersRepository } from '@/lib/repositories/users-repository'

async function checkNotifications() {
  const username = process.argv[2] || 'enrique89'

  console.log(`🔍 Verificando notificaciones para: ${username}\n`)

  try {
    // 1. Obtener builder
    const usersRepo = new UsersRepository()
    const user = await usersRepo.getByUsername(username)

    if (!user) {
      console.error(`❌ Usuario no encontrado: ${username}`)
      return
    }

    console.log(`✅ Usuario encontrado:`)
    console.log(`   ID: ${user.id}`)
    console.log(`   Role: ${user.role}`)
    console.log(`   Active: ${user.is_active}\n`)

    // 2. Obtener todas las notificaciones
    const allNotifications = await db.execute({
      sql: 'SELECT * FROM Notifications WHERE user_id = ? ORDER BY created_at DESC',
      args: [user.id],
    })

    console.log(`📊 Total de notificaciones: ${allNotifications.rows.length}\n`)

    if (allNotifications.rows.length === 0) {
      console.log('⚠️  No hay notificaciones para este usuario.')
      console.log('\n💡 Creando notificación de prueba...\n')

      // Crear notificación de prueba
      await db.execute({
        sql: `
          INSERT INTO Notifications (user_id, type, title, message, metadata)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          user.id,
          'pending_credits',
          'Créditos Pendientes',
          'Tienes 10 créditos por reclamar',
          JSON.stringify({ amount: 10 }),
        ],
      })

      console.log('✅ Notificación de prueba creada!')
    } else {
      allNotifications.rows.forEach((row: any, index) => {
        console.log(`📬 Notificación ${index + 1}:`)
        console.log(`   ID: ${row.id}`)
        console.log(`   Type: ${row.type}`)
        console.log(`   Title: ${row.title}`)
        console.log(`   Message: ${row.message}`)
        console.log(`   Is Read: ${row.is_read ? 'Sí' : 'No'}`)
        console.log(`   Created: ${row.created_at}`)
        console.log(`   Metadata: ${row.metadata || 'N/A'}`)
        console.log('')
      })

      // Count unread
      const unreadCount = allNotifications.rows.filter((r: any) => !r.is_read).length
      console.log(`🔔 Notificaciones sin leer: ${unreadCount}`)
    }

    // 3. Verificar créditos
    const credits = await db.execute({
      sql: 'SELECT * FROM Credits WHERE builder_id = ?',
      args: [user.id],
    })

    if (credits.rows.length > 0) {
      const credit = credits.rows[0] as any
      console.log(`\n💳 Estado de créditos:`)
      console.log(`   Pending: ${credit.pending_amount}`)
      console.log(`   Available: ${credit.available_amount}`)
      console.log(`   Total Assigned: ${credit.total_assigned}`)
      console.log(`   Total Consumed: ${credit.total_consumed}`)
    }
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

checkNotifications()

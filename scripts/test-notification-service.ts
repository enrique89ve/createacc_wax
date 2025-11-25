/**
 * Test del servicio de notificaciones
 */

import { getUnreadCount, getUnreadNotifications } from '@/lib/notification-service'

async function testNotificationService() {
  const userId = 2 // enrique89

  console.log('🧪 Probando servicio de notificaciones...\n')

  try {
    // Test 1: getUnreadCount
    console.log('1️⃣ Test: getUnreadCount()')
    const count = await getUnreadCount(userId)
    console.log(`   Resultado: ${count} notificaciones no leídas\n`)

    // Test 2: getUnreadNotifications
    console.log('2️⃣ Test: getUnreadNotifications()')
    const notifications = await getUnreadNotifications(userId)
    console.log(`   Resultado: ${notifications.length} notificaciones\n`)

    if (notifications.length > 0) {
      notifications.forEach((n, index) => {
        console.log(`   📬 Notificación ${index + 1}:`)
        console.log(`      ID: ${n.id}`)
        console.log(`      Type: ${n.type}`)
        console.log(`      Title: ${n.title}`)
        console.log(`      Message: ${n.message}`)
        console.log(`      Created: ${n.created_at}`)
        console.log('')
      })
    }

    console.log('✅ Tests completados exitosamente!')
  } catch (error) {
    console.error('❌ Error en tests:', error)
  }
}

testNotificationService()

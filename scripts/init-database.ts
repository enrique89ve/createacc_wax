import { initializeDatabase } from '@/lib/database'

async function main() {
  console.log('🔧 Initializing database schema...')

  try {
    const success = await initializeDatabase()

    if (success) {
      console.log('✅ Database initialized successfully!')
      console.log('📊 All tables, triggers, and indexes created.')
    } else {
      console.error('❌ Failed to initialize database.')
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Error during database initialization:', error)
    process.exit(1)
  }
}

main()

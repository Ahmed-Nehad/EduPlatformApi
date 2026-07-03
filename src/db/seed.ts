import { fileURLToPath } from 'url'
import db from './connection.ts'
import { sql } from 'drizzle-orm'

async function seed() {
  console.log('🌱 Starting database seed...')

  try {
    const tables = [
      'student_devices',
      'password_reset_tokens',
      'email_verification_tokens',
      'students',
      'teachers',
      'admins',
    ]

    /**
     * Resets the auth-related tables and Redis between tests for isolation.
     * Call in `afterEach`.
     */
    await db.execute(
      sql.raw(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
    )

  } catch (error) {
    console.error('❌ Seed failed:', error)
    throw error
  }
}

// Run seed if this file is executed directly
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export default seed
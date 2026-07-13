import { sql } from 'drizzle-orm'
import { db } from '../../src/db/connection.ts'
import { redis } from '../../src/db/redis.ts'
import { execSync } from 'child_process'


// Snake-case identifiers matching the actual table names defined in
// src/db/schema.ts (pgTable('...', ...)). Ordered so dependents (child
// tables) are dropped before their parents; CASCADE is still applied as a
// backstop for any ordering gaps.
export const tableNames = [
  "quiz_answers",
  "quiz_questions",
  "quiz_attempts",
  "quizzes",
  "lecture_views",
  "lecture_purchases",
  "lecture_content_items",
  "files",
  "videos",
  "lectures",
  "code_redemptions",
  "redemption_codes",
  "payments",
  "wallet_transactions",
  "teacher_access_requests",
  "student_devices",
  "email_verification_tokens",
  "password_reset_tokens",
  "students",
  "teachers",
  "admins",
];

/**
 * Global setup runs once before the test suite.
 *
 * - Ensures the tables the auth tests touch exist (idempotent via IF NOT EXISTS).
 * - Flushes Redis so no stale sessions linger between runs.
 *
 * Vitest: returning an async function makes it run as the teardown after the
 * suite finishes, so we can close the DB pool + Redis connection cleanly.
 */
export default async function setup() {
  console.log('🗄️  Setting up test database...')

  try {
    // Drop all tables listed in tableNames array
    for (const tableName of tableNames) {
      if (tableName) {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`))
      }
    }

    await redis.flushdb();

    // Use drizzle-kit CLI to push schema to database
    console.log('🚀 Pushing schema using drizzle-kit...')
    execSync(
      `npx drizzle-kit push --url="${process.env.DATABASE_URL}" --schema="./src/db/schema.ts" --dialect="postgresql"`,
      {
        stdio: 'inherit',
        cwd: process.cwd(),
      }
    )

    console.log('✅ Test database setup complete')
  } catch (error) {
    console.error('❌ Failed to setup test database:', error)
    throw error
  }

  return async () => {
    console.log('🧹 Tearing down test database...')

    try {
      // Drop all tables listed in tableNames array
      for (const tableName of tableNames) {
        if (tableName) {
          await db.execute(sql.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`))
        }
      }

      await redis.quit()

      console.log('✅ Test database teardown complete')
      process.exit(0)
    } catch (error) {
      console.error('❌ Failed to teardown test database:', error)
    }
  }
}

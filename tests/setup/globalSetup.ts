import { sql } from 'drizzle-orm'
import { db } from '../../src/db/connection.ts'
import { redis } from '../../src/db/redis.ts'

/**
 * Global setup runs once before the test suite.
 *
 * - Ensures the tables the auth tests touch exist (idempotent via IF NOT EXISTS).
 * - Flushes Redis so no stale sessions linger between runs.
 *
 * Vitest: returning an async function makes it run as the teardown after the
 * suite finishes, so we can close the DB pool + Redis connection cleanly.
 */
export async function setup() {
  console.log('🧪 [globalSetup] preparing test database...')

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS admins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(120) NOT NULL,
      email varchar(120) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS teachers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(120) NOT NULL,
      email varchar(120) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      bio text,
      avatar_r2_key text,
      is_active boolean NOT NULL DEFAULT true,
      created_by_admin_id uuid NOT NULL REFERENCES admins(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS students (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(120) NOT NULL,
      email varchar(120) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      email_verified_at timestamptz,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_email_verify_student ON email_verification_tokens(student_id)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS student_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      device_fingerprint text NOT NULL,
      device_label varchar(120),
      slot_number smallint NOT NULL,
      bound_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      revoked_reason text,
      CONSTRAINT student_devices_student_id_slot_number_unique UNIQUE (student_id, slot_number),
      CONSTRAINT student_devices_student_id_device_fingerprint_unique UNIQUE (student_id, device_fingerprint),
      CONSTRAINT student_devices_slot_number_check CHECK (slot_number in (1, 2))
    )
  `)

  // Flush Redis session keys so tests start clean.
  await redis.flushdb()
  console.log('🧪 [globalSetup] ready')

  // Teardown: close connections so the process can exit cleanly.
  return async () => {
    console.log('🧪 [globalTeardown] closing connections...')
    await redis.quit()
    await (db.$client as { end: () => Promise<void> }).end()
    console.log('🧪 [globalTeardown] done')
  }
}

export default setup

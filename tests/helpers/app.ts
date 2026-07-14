import request, { type Agent } from 'supertest'
import { sql } from 'drizzle-orm'
import app from '../../src/server.ts'
import { db } from '../../src/db/connection.ts'
import { redis } from '../../src/db/redis.ts'
import { SESSION_COOKIE_NAME } from '../../src/services/sessionService.ts'
import type { TestUser } from './factories.ts'
import { fingerprint } from './factories.ts'

/**
 * Tables touched by auth tests, ordered so that dependents are cleared first.
 * We TRUNCATE ... CASCADE to reset sequences + FK-linked rows.
 */
const AUTH_TABLES = [
  'student_devices',
  'teacher_access_requests',
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
export async function resetAuthState() {
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${AUTH_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  )
  await redis.flushdb()
}

const BASE = '/v1/auth'

/**
 * Returns a supertest **agent** bound to the real Express app.
 *
 * Using an agent (rather than `request(app)` per call) preserves cookies
 * across requests, which is essential for login → /me → logout flows.
 * Each call returns a fresh agent, so tests that call `api()` multiple times
 * get independent cookie jars.
 */
export const api = () => request.agent(app)

/**
 * Logs in a user via the API and returns the combined `Cookie` header value
 * (from all `Set-Cookie` entries) so tests can attach it to subsequent requests.
 *
 * We extract cookies manually because supertest's agent does not reliably
 * replay signed cookies across requests in all environments.
 */
export async function loginAs(
  user: TestUser,
  fpSeed = 'device1'
): Promise<{ cookie: string; agent: Agent }> {
  const agent = api()
  const res = await agent.post(`${BASE}/login`).send({
    email: user.email,
    password: user.password,
    ...(user.role === 'student'
      ? { device_fingerprint: fingerprint(fpSeed) }
      : {}),
  })

  if (res.status !== 200) {
    throw new Error(`loginAs failed: ${res.status} ${JSON.stringify(res.body)}`)
  }

  // `set-cookie` can be undefined, a single string, or an array of strings
  // depending on the HTTP client/version. Normalize to an array.
  const rawSetCookie = res.headers['set-cookie'] as string[] | string | undefined
  const setCookieEntries = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : rawSetCookie
      ? [rawSetCookie]
      : []

  const cookie = combineCookies(setCookieEntries)
  return { cookie, agent }
}

/**
 * Takes an array of raw `Set-Cookie` header strings (each possibly containing
 * attributes like Path, HttpOnly, Secure, SameSite, Expires, Max-Age) and
 * combines just the `name=value` pairs into a single valid `Cookie` header
 * value, joined with `; `, suitable for replaying on subsequent requests.
 */
function combineCookies(setCookieEntries: string[]): string {
  return setCookieEntries
    .map((entry) => entry.split(';')[0]?.trim()) // keep only "name=value"
    .filter((pair): pair is string => Boolean(pair))
    .join('; ')
}

/** Builds a `Cookie` header object from a raw (possibly multi-cookie) string. */
export const cookieHeader = (cookie: string) => ({ Cookie: cookie })

export { app, SESSION_COOKIE_NAME }

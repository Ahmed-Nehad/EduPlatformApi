import { randomBytes } from 'node:crypto'
import { redis } from '../db/redis.ts'
import { env, isProd } from '../../env.ts'
import type { SessionData, SessionUser } from '../types/authTypes.ts'

const SESSION_KEY_PREFIX = 'session:'
const SESSION_INDEX_PREFIX = 'session:user:'

const key = (sessionId: string) => `${SESSION_KEY_PREFIX}${sessionId}`
const indexKey = (userId: string) => `${SESSION_INDEX_PREFIX}${userId}`

/**
 * Creates a new session in Redis and returns the opaque session id that is
 * placed in the cookie. The session auto-expires via Redis TTL.
 */
export const createSession = async (
  user: SessionUser,
  deviceId?: string
): Promise<{ sessionId: string; session: SessionData }> => {
  const sessionId = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + env.SESSION_TTL_SECONDS * 1000
  ).toISOString()

  const session: SessionData = {
    user,
    deviceId,
    expiresAt,
    createdAt: now.toISOString(),
  }

  // Store the session with a TTL so Redis evicts it automatically.
  await redis.set(key(sessionId), JSON.stringify(session), 'EX', env.SESSION_TTL_SECONDS)

  // Track the session id under the user's index set (for listing/revocation).
  await redis.sadd(indexKey(user.id), sessionId)
  await redis.expire(indexKey(user.id), env.SESSION_TTL_SECONDS)

  return { sessionId, session }
}

/** Reads & deserializes a session. Returns null if missing/expired. */
export const getSession = async (
  sessionId: string
): Promise<SessionData | null> => {
  const raw = await redis.get(key(sessionId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

/**
 * Refreshes the sliding TTL on an existing session (rolling expiration).
 * Called on every authenticated request via the middleware.
 */
export const touchSession = async (sessionId: string): Promise<void> => {
  await redis.expire(key(sessionId), env.SESSION_TTL_SECONDS)
}

/** Destroys a single session (logout / device revocation). */
export const destroySession = async (
  sessionId: string,
  userId?: string
): Promise<void> => {
  await redis.del(key(sessionId))
  if (userId) {
    await redis.srem(indexKey(userId), sessionId)
  }
}

/** Destroys every session belonging to a user (e.g. on password reset). */
export const destroyAllUserSessions = async (userId: string): Promise<void> => {
  const sessionIds = await redis.smembers(indexKey(userId))
  if (sessionIds.length === 0) return
  const pipeline = redis.pipeline()
  for (const sid of sessionIds) pipeline.del(key(sid))
  pipeline.del(indexKey(userId))
  await pipeline.exec()
}

/** Cookie options shared by login/logout. */
export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: 'lax' as const,
  path: '/',
  maxAge: env.SESSION_TTL_SECONDS * 1000,
})

export const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME

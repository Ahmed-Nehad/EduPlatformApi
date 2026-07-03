import type { Request } from 'express'

export type UserRole = 'admin' | 'teacher' | 'student'

/**
 * The minimal, role-agnostic user object stored inside the Redis session.
 * Keeping it small avoids stale data and keeps session payloads light.
 */
export interface SessionUser {
  id: string
  role: UserRole
  name: string
  email: string
}

/**
 * Full session payload persisted in Redis under `session:<sessionId>`.
 */
export interface SessionData {
  user: SessionUser
  /** For students: the device row this session is bound to. */
  deviceId?: string
  /** ISO timestamp at which the session expires. */
  expiresAt: string
  /** When the session was created. */
  createdAt: string
}

export interface AuthenticatedRequest extends Request {
  user?: SessionUser
  sessionId?: string
  session?: SessionData
  deviceId?: string
}

import type { Response, NextFunction } from 'express'
import { AppError } from '../utils/AppError.ts'
import { getSession, touchSession, SESSION_COOKIE_NAME } from '../services/sessionService.ts'
import type { AuthenticatedRequest, SessionUser, UserRole } from '../types/authTypes.ts'

/**
 * Requires a valid Redis session. Loads the session, attaches `req.user`,
 * `req.session`, and `req.deviceId`, then refreshes the sliding TTL.
 *
 * Use on any endpoint marked "Any" auth in the spec.
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined

    if (!sessionId) {
      return next(AppError.unauthorized('NO_SESSION', 'No active session'))
    }

    const session = await getSession(sessionId)
    if (!session) {
      return next(AppError.unauthorized('SESSION_EXPIRED', 'Session expired or invalid'))
    }

    req.sessionId = sessionId
    req.session = session
    req.user = session.user
    req.deviceId = session.deviceId

    // Rolling expiration: refresh TTL on activity. Also refresh the user's
    // session-index set so it does not expire before the sessions it tracks.
    await touchSession(sessionId, session.user.id)

    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Requires an authenticated user AND one of the allowed roles.
 *
 * Usage: `router.get('/x', authenticate, requireRole('student'), handler)`
 */
export const requireRole =
  (...roles: UserRole[]) =>
  (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const user: SessionUser | undefined = req.user
    if (!user) {
      return next(AppError.unauthorized())
    }
    if (!roles.includes(user.role)) {
      return next(
        AppError.forbidden('ROLE_FORBIDDEN', 'You do not have access to this resource')
      )
    }
    next()
  }

/** Backwards-compatible alias for the existing export name. */
export const authenticateToken = authenticate

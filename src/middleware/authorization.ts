import type { Response, NextFunction } from 'express'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'

/**
 * Lightweight authorization middleware.
 *
 * Per `ai/documentation-6.md`, middleware is reserved for cheap, HTTP-level
 * checks only (session, role, device header presence). Business-level
 * authorization (ownership, purchase, access requests) lives inside
 * controllers, folded into the main query via JOINs and WHERE clauses.
 */

/**
 * Requires the `X-Device-Fingerprint` header to be present for students.
 *
 * This is a *presence* check only — it does not query the database. The device
 * was validated at login time and its id is stored in the Redis session, so
 * the controller can trust `req.deviceId` for any device-scoped work.
 *
 * Non-student roles (teacher/admin) are allowed through without the header.
 */
export const requireStudentDeviceHeader = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  // Only students are required to send the device fingerprint header.
  if (req.user?.role !== 'student') {
    return next()
  }

  const header =
    (req.headers['x-device-fingerprint'] as string | undefined) ??
    (req.headers['X-Device-Fingerprint'] as string | undefined)

  if (!header) {
    return next(
      AppError.badRequest(
        'DEVICE_FINGERPRINT_REQUIRED',
        'The X-Device-Fingerprint header is required for student requests'
      )
    )
  }

  next()
}

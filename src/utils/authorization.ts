import { AppError } from './AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import type { Lecture, TeacherAccessRequest, LecturePurchase } from '../db/schema.ts'

/**
 * Reusable authorization assertions.
 *
 * These are *pure* helpers: they only inspect rows the controller has already
 * fetched and throw an `AppError` when a check fails. They never query the DB.
 *
 * The intent (see `ai/documentation-6.md`) is to fold ownership / access /
 * purchase checks into the controller's main query via JOINs, then call these
 * helpers against the resulting row. This keeps the middleware chain thin and
 * avoids N+1 authorization queries before the controller even runs.
 */

/**
 * Asserts that the calling teacher owns a resource.
 *
 * Used after a controller has fetched a resource row that carries a
 * `teacherId`. Throws `403 NOT_OWNER` when the caller's id does not match.
 */
export const assertTeacherOwns = (
  req: AuthenticatedRequest,
  resourceTeacherId: string
): void => {
  if (req.user!.id !== resourceTeacherId) {
    throw AppError.forbidden(
      'NOT_OWNER',
      'You do not own this resource'
    )
  }
}

/**
 * Asserts that a lecture is available to be served.
 *
 * - `null`/`undefined` → `404 LECTURE_NOT_FOUND`
 * - soft-deleted (`deletedAt` set) → `404 LECTURE_NOT_FOUND`
 * - not `published` → `403 LECTURE_NOT_PUBLISHED`
 * - past `expiresAt` → `403 LECTURE_EXPIRED`
 *
 * `now` is injectable for deterministic tests.
 */
export const assertLectureAvailable = (
  lecture: Pick<Lecture, 'status' | 'deletedAt' | 'expiresAt'> | null | undefined,
  now: Date = new Date()
): void => {
  if (!lecture || lecture.deletedAt) {
    throw AppError.notFound('LECTURE_NOT_FOUND', 'Lecture not found')
  }
  if (lecture.status !== 'published') {
    throw AppError.forbidden(
      'LECTURE_NOT_PUBLISHED',
      'This lecture is not published'
    )
  }
  if (lecture.expiresAt && lecture.expiresAt < now) {
    throw AppError.forbidden(
      'LECTURE_EXPIRED',
      'This lecture has expired'
    )
  }
}

/**
 * Asserts that a student has an *approved* access request to a teacher.
 *
 * `accessRow` is the (possibly null) `teacher_access_requests` row joined into
 * the controller's main query. A missing or non-approved row throws
 * `403 TEACHER_ACCESS_REQUIRED`.
 */
export const assertStudentAccessApproved = (
  accessRow: Pick<TeacherAccessRequest, 'status'> | null | undefined
): void => {
  if (!accessRow || accessRow.status !== 'approved') {
    throw AppError.forbidden(
      'TEACHER_ACCESS_REQUIRED',
      'You do not have approved access to this teacher'
    )
  }
}

/**
 * Asserts that a student has purchased a lecture.
 *
 * `purchaseRow` is the (possibly null) `lecture_purchases` row joined into the
 * controller's main query. A missing row throws `403 LECTURE_NOT_PURCHASED`.
 */
export const assertLecturePurchased = (
  purchaseRow: Pick<LecturePurchase, 'id'> | null | undefined
): void => {
  if (!purchaseRow) {
    throw AppError.forbidden(
      'LECTURE_NOT_PURCHASED',
      'You have not purchased this lecture'
    )
  }
}

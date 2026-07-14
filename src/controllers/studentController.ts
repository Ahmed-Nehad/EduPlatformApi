import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  studentDevices,
  teacherAccessRequests,
  teachers,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, desc, eq, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the SQL offset for a page/limit pair (1-indexed pages).
 */
const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// GET /student/devices — list my bound devices
// ---------------------------------------------------------------------------

/**
 * Returns every device row bound to the calling student, including revoked
 * ones, so the student can audit their own device history and see which slots
 * are currently occupied. Ordered by slot number for a stable layout.
 *
 * Mirrors the admin `listStudentDevices` shape (minus the student_id echo,
 * since here the student is the caller).
 */
export const listMyDevices = async (req: AuthenticatedRequest, res: Response) => {
  const studentId = req.user!.id

  const devices = await db
    .select({
      id: studentDevices.id,
      device_fingerprint: studentDevices.deviceFingerprint,
      device_label: studentDevices.deviceLabel,
      slot_number: studentDevices.slotNumber,
      bound_at: studentDevices.boundAt,
      last_seen_at: studentDevices.lastSeenAt,
      revoked_at: studentDevices.revokedAt,
      revoked_reason: studentDevices.revokedReason,
    })
    .from(studentDevices)
    .where(eq(studentDevices.studentId, studentId))
    .orderBy(studentDevices.slotNumber)

  res.status(200).json({ success: true, data: { devices } })
}

// ---------------------------------------------------------------------------
// POST /student/access-requests/:teacherId — request access to a teacher
// ---------------------------------------------------------------------------

/**
 * Creates a pending access request from the calling student to a teacher.
 *
 * Pre-checks:
 *  - The teacher must exist and be active, else 404 TEACHER_NOT_FOUND.
 *  - There must be no existing request row for this (student, teacher) pair in
 *    *any* status. Per the product decision, a student may not re-request
 *    access regardless of the prior outcome (pending/approved/rejected).
 *
 * The DB unique constraint on (student_id, teacher_id) is the race backstop:
 * if two concurrent requests slip past the pre-check, the insert throws a
 * unique violation which we translate to 409 ACCESS_REQUEST_EXISTS.
 */
export const createAccessRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id
  const { teacherId } = req.params

  // 1. Teacher must exist and be active.
  const [teacher] = await db
    .select({ id: teachers.id })
    .from(teachers)
    .where(and(eq(teachers.id, teacherId), eq(teachers.isActive, true)))
    .limit(1)

  if (!teacher) {
    throw AppError.notFound('TEACHER_NOT_FOUND', 'No active teacher found with that id')
  }

  // 2. No existing request in any status (no re-request allowed).
  const [existing] = await db
    .select({ id: teacherAccessRequests.id })
    .from(teacherAccessRequests)
    .where(
      and(
        eq(teacherAccessRequests.studentId, studentId),
        eq(teacherAccessRequests.teacherId, teacherId)
      )
    )
    .limit(1)

  if (existing) {
    throw AppError.conflict(
      'ACCESS_REQUEST_EXISTS',
      'An access request for this teacher already exists'
    )
  }

  // 3. Insert the pending request. The unique constraint is the race backstop.
  let created: typeof teacherAccessRequests.$inferSelect
  try {
    const [row] = await db
      .insert(teacherAccessRequests)
      .values({ studentId, teacherId, status: 'pending' })
      .returning()
    created = row
  } catch (err) {
    // Unique violation → race lost; treat as conflict.
    throw AppError.conflict(
      'ACCESS_REQUEST_EXISTS',
      'An access request for this teacher already exists'
    )
  }

  res.status(201).json({ success: true, data: { accessRequest: created } })
}

// ---------------------------------------------------------------------------
// GET /student/my-teachers — teachers who approved me (paginated)
// ---------------------------------------------------------------------------

/**
 * Paginated join of `teachers` INNER JOIN `teacherAccessRequests` filtered to
 * the calling student and `status = 'approved'`. Returns teacher profile fields
 * plus the access-request metadata. Pagination meta matches the admin/teacher
 * list endpoints.
 */
export const listMyTeachers = async (req: AuthenticatedRequest, res: Response) => {
  const studentId = req.user!.id
  const { page, limit } = req.query as unknown as { page: number; limit: number }
  const offset = offsetFor(page, limit)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: teachers.id,
        name: teachers.name,
        email: teachers.email,
        bio: teachers.bio,
        avatar_r2_key: teachers.avatarR2Key,
        is_active: teachers.isActive,
        role: sql<'teacher'>`'teacher'`.as('role'),
        access_request_status: teacherAccessRequests.status,
        requested_at: teacherAccessRequests.requestedAt,
        decided_at: teacherAccessRequests.decidedAt,
        created_at: teachers.createdAt,
        updated_at: teachers.updatedAt,
      })
      .from(teachers)
      .innerJoin(
        teacherAccessRequests,
        and(
          eq(teacherAccessRequests.studentId, studentId),
          eq(teacherAccessRequests.teacherId, teachers.id),
          eq(teacherAccessRequests.status, 'approved')
        )
      )
      .orderBy(desc(teachers.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(teachers)
      .innerJoin(
        teacherAccessRequests,
        and(
          eq(teacherAccessRequests.studentId, studentId),
          eq(teacherAccessRequests.teacherId, teachers.id),
          eq(teacherAccessRequests.status, 'approved')
        )
      ),
  ])

  res.status(200).json({
    success: true,
    data: { teachers: rows },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

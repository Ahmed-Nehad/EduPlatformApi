import type { Response } from 'express'
import { db } from '../db/connection.ts'
import { students, teacherAccessRequests, teachers } from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { AccessRequestStatus } from '../validations/teacherValidation.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the SQL offset for a page/limit pair (1-indexed pages).
 */
const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// GET /teacher/students — list all approved students (paginated)
// ---------------------------------------------------------------------------

export const listStudents = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { page, limit, status } = req.query as unknown as { page: number; limit: number, status: AccessRequestStatus }
  const offset = offsetFor(page, limit)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: students.id,
        name: students.name,
        email: students.email,
        isActive: students.isActive,
        emailVerifiedAt: students.emailVerifiedAt,
        role: sql<'student'>`'student'`.as('role'),
        accessRequestStatus: teacherAccessRequests.status,
        createdAt: students.createdAt,
        updatedAt: students.updatedAt,
      })
      .from(students)
      .innerJoin(teacherAccessRequests, 
        and(
          eq(teacherAccessRequests.teacherId, teacherId),
          eq(teacherAccessRequests.studentId, students.id),
          eq(teacherAccessRequests.status, status)
        )
      )
      .orderBy(desc(students.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(students)
      .innerJoin(teacherAccessRequests, 
        and(
          eq(teacherAccessRequests.teacherId, teacherId),
          eq(teacherAccessRequests.studentId, students.id),
          eq(teacherAccessRequests.status, status)
        )
      ),
  ])

  res.status(200).json({
    success: true,
    data: { students: rows },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

export const updateRequestAccessStatus = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { userId } = req.params
  const { status } = req.body as unknown as { status: AccessRequestStatus }

  const [updated] = await db
  .update(teacherAccessRequests)
  .set({
    status,
    decidedAt: new Date(),
  })
  .where(
    and(
      eq(teacherAccessRequests.studentId, userId),
      eq(teacherAccessRequests.teacherId, teacherId)
    )
  )
  .returning({
    id: teacherAccessRequests.id,
    status: teacherAccessRequests.status,
    decidedAt: teacherAccessRequests.decidedAt,
    requestedAt: teacherAccessRequests.requestedAt
  })

  if (!updated) {
    throw AppError.notFound('ACCESS_REQUEST_NOT_FOUND', 'No access request was found with that user id')
  }

  res.status(200).json({
    success: true,
    data: { accessRequest: updated },
  })
}
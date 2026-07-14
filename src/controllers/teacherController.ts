import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  students,
  teacherAccessRequests,
  teachers,
  lectures,
  lectureContentItems,
  videos,
  files,
  quizzes,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
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

// ===========================================================================
// LECTURES — Teacher CRUD
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /teacher/lectures — create a lecture (always starts as draft)
// ---------------------------------------------------------------------------

/**
 * Creates a new lecture owned by the calling teacher. New lectures always start
 * with `status = 'draft'` (the column default) so they are hidden from the
 * public catalog until the teacher explicitly publishes them.
 */
export const createLecture = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { title, description, price, thumbnailR2Key } = req.body as {
    title: string
    description?: string
    price: number
    thumbnailR2Key?: string
  }

  const [created] = await db
    .insert(lectures)
    .values({
      teacherId,
      title,
      description: description ?? null,
      price: price.toString(),
      thumbnailR2Key: thumbnailR2Key ?? null,
      // status defaults to 'draft' via the column default
    })
    .returning()

  res.status(201).json({ success: true, data: { lecture: created } })
}

// ---------------------------------------------------------------------------
// PATCH /teacher/lectures/:id — partial update (ownership via WHERE)
// ---------------------------------------------------------------------------

/**
 * Partially updates a lecture. Ownership is enforced for free via the
 * `WHERE` clause (`teacher_id = caller`), so a row that belongs to another
 * teacher (or does not exist) yields an empty `.returning()` and a 404.
 */
export const updateLecture = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const body = req.body as {
    title?: string
    description?: string | null
    price?: number
    thumbnailR2Key?: string | null
    status?: 'draft' | 'published'
  }

  const [updated] = await db
    .update(lectures)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price !== undefined && { price: body.price.toString() }),
      ...(body.thumbnailR2Key !== undefined && {
        thumbnailR2Key: body.thumbnailR2Key,
      }),
      ...(body.status !== undefined && { status: body.status }),
      updatedAt: new Date(),
    })
    .where(and(eq(lectures.id, id), eq(lectures.teacherId, teacherId)))
    .returning()

  if (!updated) {
    throw AppError.notFound(
      'LECTURE_NOT_FOUND',
      'Lecture not found or not owned by you'
    )
  }

  res.status(200).json({ success: true, data: { lecture: updated } })
}

// ---------------------------------------------------------------------------
// DELETE /teacher/lectures/:id — soft delete (ownership via WHERE)
// ---------------------------------------------------------------------------

/**
 * Soft-deletes a lecture by setting `deleted_at`. Ownership is enforced via
 * the `WHERE` clause. A lecture that is already soft-deleted returns the same
 * 404, keeping the operation idempotent from the caller's perspective.
 */
export const deleteLecture = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params

  const [updated] = await db
    .update(lectures)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(lectures.id, id),
        eq(lectures.teacherId, teacherId),
        isNull(lectures.deletedAt)
      )
    )
    .returning({ id: lectures.id, deletedAt: lectures.deletedAt })

  if (!updated) {
    throw AppError.notFound(
      'LECTURE_NOT_FOUND',
      'Lecture not found or not owned by you'
    )
  }

  res.status(200).json({ success: true, data: { lecture: updated } })
}

// ---------------------------------------------------------------------------
// GET /teacher/lectures — list my lectures (paginated)
// ---------------------------------------------------------------------------

/**
 * Returns the calling teacher's own lectures (draft + published), newest
 * first, with a `meta` block. Soft-deleted lectures are excluded. An optional
 * `status` query filter scopes the list to `draft` or `published`.
 */
export const listLectures = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { page, limit, status } = req.query as unknown as {
    page: number
    limit: number
    status?: 'draft' | 'published'
  }
  const offset = offsetFor(page, limit)

  const whereClauses = [
    eq(lectures.teacherId, teacherId),
    isNull(lectures.deletedAt),
    ...(status ? [eq(lectures.status, status)] : []),
  ]

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: lectures.id,
        title: lectures.title,
        description: lectures.description,
        price: lectures.price,
        thumbnailR2Key: lectures.thumbnailR2Key,
        status: lectures.status,
        createdAt: lectures.createdAt,
        updatedAt: lectures.updatedAt,
        expiresAt: lectures.expiresAt,
      })
      .from(lectures)
      .where(and(...whereClauses))
      .orderBy(desc(lectures.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(lectures)
      .where(and(...whereClauses)),
  ])

  res.status(200).json({
    success: true,
    data: { lectures: rows },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

// ===========================================================================
// GET /teacher/lectures/:id — single lecture detail with content items
// ===========================================================================

/**
 * Returns a single lecture (any status, including drafts) owned by the calling
 * teacher, plus its ordered content items with their IDs. Unlike the public
 * `GET /lectures/:id`, this endpoint:
 *   - Allows drafts (no status filter)
 *   - Enforces ownership (WHERE teacherId = caller)
 *   - Returns content item IDs (needed for reorder/remove operations)
 *
 * Content items use the same conditional LEFT JOINs as the public detail
 * endpoint, but select `lci.id` and `lci.content_id` so the teacher can
 * reference them in subsequent mutations.
 */
export const getTeacherLectureDetail = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { id } = req.params

  // 1. Load the lecture (must be owned by the caller, not deleted).
  //    Ownership folded into WHERE — foreign lecture → 404 (not 403).
  const [lecture] = await db
    .select({
      id: lectures.id,
      title: lectures.title,
      description: lectures.description,
      price: lectures.price,
      thumbnailR2Key: lectures.thumbnailR2Key,
      status: lectures.status,
      createdAt: lectures.createdAt,
      updatedAt: lectures.updatedAt,
      expiresAt: lectures.expiresAt,
      deletedAt: lectures.deletedAt,
    })
    .from(lectures)
    .where(
      and(
        eq(lectures.id, id),
        eq(lectures.teacherId, teacherId),
        isNull(lectures.deletedAt)
      )
    )
    .limit(1)

  if (!lecture) {
    throw AppError.notFound(
      'LECTURE_NOT_FOUND',
      'Lecture not found or not owned by you'
    )
  }

  // 2. Build the content list with conditional LEFT JOINs (same pattern as
  //    the public lectureController, but including item IDs).
  const content_items = await db
    .select({
      id: lectureContentItems.id,
      content_type: lectureContentItems.contentType,
      content_id: lectureContentItems.contentId,
      position: lectureContentItems.position,
      content_name: sql<string>`COALESCE(${videos.title}, ${files.title}, ${quizzes.title})`,
      description: sql<string | null>`COALESCE(${videos.description}, ${files.description}, ${quizzes.description})`,
      duration_seconds: videos.durationSeconds,
    })
    .from(lectureContentItems)
    .leftJoin(
      videos,
      and(
        eq(lectureContentItems.contentType, 'video'),
        eq(lectureContentItems.contentId, videos.id),
        isNull(videos.deletedAt)
      )
    )
    .leftJoin(
      files,
      and(
        eq(lectureContentItems.contentType, 'file'),
        eq(lectureContentItems.contentId, files.id),
        isNull(files.deletedAt)
      )
    )
    .leftJoin(
      quizzes,
      and(
        eq(lectureContentItems.contentType, 'quiz'),
        eq(lectureContentItems.contentId, quizzes.id)
      )
    )
    .where(eq(lectureContentItems.lectureId, id))
    .orderBy(asc(lectureContentItems.position))

  res.status(200).json({
    success: true,
    data: {
      lecture,
      content_items,
    },
  })
}
import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  lectures,
  lectureContentItems,
  videos,
  files,
  quizzes,
  teachers,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import { assertLectureAvailable } from '../utils/authorization.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// GET /lectures — public catalog of published lectures
// ---------------------------------------------------------------------------

/**
 * Returns published, non-deleted, non-expired lectures, newest first, with a
 * `meta` block. An optional `teacher_id` query param scopes the catalog to a
 * single teacher.
 *
 * No session is required — any caller (including anonymous) gets the same
 * result. Content items are intentionally excluded; the detail endpoint
 * returns them.
 */
export const listLecturesCatalog = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { page, limit, teacher_id } = req.query as unknown as {
    page: number
    limit: number
    teacher_id?: string
  }
  const offset = offsetFor(page, limit)

  const whereClauses = [
    eq(lectures.status, 'published'),
    isNull(lectures.deletedAt),
    ...(teacher_id ? [eq(lectures.teacherId, teacher_id)] : []),
  ]

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: lectures.id,
        title: lectures.title,
        description: lectures.description,
        price: lectures.price,
        thumbnailR2Key: lectures.thumbnailR2Key,
        teacherId: lectures.teacherId,
        teacherName: teachers.name,
        createdAt: lectures.createdAt,
        expiresAt: lectures.expiresAt,
      })
      .from(lectures)
      .innerJoin(teachers, eq(teachers.id, lectures.teacherId))
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

// ---------------------------------------------------------------------------
// GET /lectures/:id — lecture detail + content list
// ---------------------------------------------------------------------------

/**
 * Returns a single published lecture plus its ordered content items.
 *
 * Per the plan, all users (including anonymous) get the *same* result — no
 * purchase or access gating is applied here. Content items return lightweight
 * info (no IDs): `content_type`, `content_name`, `description`, `position`,
 * and `duration_seconds` (only for videos).
 *
 * The content list is built with conditional LEFT JOINs on the polymorphic
 * `lecture_content_items` table, mirroring the SQL in the plan:
 *
 *   SELECT lci.content_type, lci.position,
 *     COALESCE(v.title, f.title, q.title) AS content_name,
 *     COALESCE(v.description, f.description, q.description) AS description,
 *     v.duration_seconds
 *   FROM lecture_content_items lci
 *   LEFT JOIN videos v ON lci.content_type = 'video' AND lci.content_id = v.id
 *     AND v.deleted_at IS NULL
 *   LEFT JOIN files f ON lci.content_type = 'file' AND lci.content_id = f.id
 *     AND f.deleted_at IS NULL
 *   LEFT JOIN quizzes q ON lci.content_type = 'quiz' AND lci.content_id = q.id
 *   WHERE lci.lecture_id = :lectureId
 *   ORDER BY lci.position ASC
 */
export const getLectureDetail = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params

  // 1. Load the lecture (must be published, not deleted).
  const [lecture] = await db
    .select({
      id: lectures.id,
      title: lectures.title,
      description: lectures.description,
      price: lectures.price,
      thumbnailR2Key: lectures.thumbnailR2Key,
      status: lectures.status,
      deletedAt: lectures.deletedAt,
      expiresAt: lectures.expiresAt,
      teacherId: lectures.teacherId,
      teacherName: teachers.name,
      createdAt: lectures.createdAt,
    })
    .from(lectures)
    .innerJoin(teachers, eq(teachers.id, lectures.teacherId))
    .where(
      and(
        eq(lectures.id, id),
        eq(lectures.status, 'published'),
        isNull(lectures.deletedAt)
      )
    )
    .limit(1)

  // Availability check: a missing row is 404; an expired lecture is 403.
  assertLectureAvailable(lecture)

  // 2. Build the content list with conditional LEFT JOINs.
  const content_items = await db
    .select({
      content_type: lectureContentItems.contentType,
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
      lecture: {
        id: lecture!.id,
        title: lecture!.title,
        description: lecture!.description,
        price: lecture!.price,
        thumbnailR2Key: lecture!.thumbnailR2Key,
        teacherId: lecture!.teacherId,
        teacherName: lecture!.teacherName,
        createdAt: lecture!.createdAt,
        expiresAt: lecture!.expiresAt,
      },
      content_items,
    },
  })
}

// ---------------------------------------------------------------------------
// GET /teachers — public teacher catalog
// ---------------------------------------------------------------------------

export const listTeachersCatalog = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { page, limit } = req.query as unknown as {
    page: number
    limit: number
  }
  const offset = offsetFor(page, limit)

  const whereClause = eq(teachers.isActive, true)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: teachers.id,
        name: teachers.name,
        bio: teachers.bio,
        avatarR2Key: teachers.avatarR2Key,
        createdAt: teachers.createdAt,
      })
      .from(teachers)
      .where(whereClause)
      .orderBy(desc(teachers.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(teachers)
      .where(whereClause),
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

// ---------------------------------------------------------------------------
// GET /teachers/:id/lectures — published lectures for a teacher
// ---------------------------------------------------------------------------

export const listTeacherLectures = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params
  const { page, limit } = req.query as unknown as {
    page: number
    limit: number
  }
  const offset = offsetFor(page, limit)

  // Verify teacher exists and is active
  const [teacher] = await db
    .select({ id: teachers.id })
    .from(teachers)
    .where(and(eq(teachers.id, id), eq(teachers.isActive, true)))
    .limit(1)

  if (!teacher) {
    throw AppError.notFound('TEACHER_NOT_FOUND', 'Teacher not found')
  }

  const whereClause = and(
    eq(lectures.teacherId, id),
    eq(lectures.status, 'published'),
    isNull(lectures.deletedAt)
  )

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: lectures.id,
        title: lectures.title,
        description: lectures.description,
        price: lectures.price,
        thumbnailR2Key: lectures.thumbnailR2Key,
        createdAt: lectures.createdAt,
        expiresAt: lectures.expiresAt,
      })
      .from(lectures)
      .where(whereClause)
      .orderBy(desc(lectures.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(lectures)
      .where(whereClause),
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

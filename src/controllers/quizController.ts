import type { Response } from 'express'
import { db } from '../db/connection.ts'
import { quizzes, quizQuestions, lectures } from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifies that a quiz belongs to a lecture owned by the caller.
 * Returns the quiz row on success, throws 404 QUIZ_NOT_FOUND on failure.
 * Ownership is folded into the WHERE so a foreign teacher's quiz is
 * indistinguishable from a missing one (404, not 403).
 */
const assertQuizOwnership = async (quizId: string, teacherId: string) => {
  const [row] = await db
    .select({
      id: quizzes.id,
      lectureId: quizzes.lectureId,
      title: quizzes.title,
      description: quizzes.description,
      lockMode: quizzes.lockMode,
      lockUntil: quizzes.lockUntil,
      allowMultipleAttempts: quizzes.allowMultipleAttempts,
      createdAt: quizzes.createdAt,
      updatedAt: quizzes.updatedAt,
    })
    .from(quizzes)
    .innerJoin(lectures, eq(quizzes.lectureId, lectures.id))
    .where(
      and(
        eq(quizzes.id, quizId),
        eq(lectures.teacherId, teacherId),
        isNull(lectures.deletedAt)
      )
    )
    .limit(1)

  if (!row) {
    throw AppError.notFound(
      'QUIZ_NOT_FOUND',
      'Quiz not found or not owned by you'
    )
  }
  return row
}

// ---------------------------------------------------------------------------
// POST /quizzes — create quiz
// ---------------------------------------------------------------------------

export const createQuiz = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { lecture_id, title, description, lock_mode, lock_until, allow_multiple_attempts } =
    req.body

  // 1. Verify lecture exists, is owned by caller, and is not soft-deleted.
  const [lecture] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(
      and(
        eq(lectures.id, lecture_id),
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

  // 2. Insert quiz.
  const [created] = await db
    .insert(quizzes)
    .values({
      lectureId: lecture_id,
      title,
      description: description ?? null,
      lockMode: lock_mode,
      lockUntil: lock_until ? new Date(lock_until) : null,
      allowMultipleAttempts: allow_multiple_attempts,
    })
    .returning()

  res.status(201).json({ success: true, data: { quiz: created } })
}

// ---------------------------------------------------------------------------
// GET /quizzes/:id — get quiz with questions (teacher view, includes answers)
// ---------------------------------------------------------------------------

export const getQuiz = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params

  // 1. Ownership check.
  const quiz = await assertQuizOwnership(id, teacherId)

  // 2. Load questions ordered by position.
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, id))
    .orderBy(asc(quizQuestions.position))

  res.status(200).json({ success: true, data: { quiz, questions } })
}

// ---------------------------------------------------------------------------
// PATCH /quizzes/:id — update quiz settings (partial)
// ---------------------------------------------------------------------------

export const updateQuiz = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const body = req.body as {
    title?: string
    description?: string
    lock_mode?: 'after_submission' | 'calendar'
    lock_until?: string
    allow_multiple_attempts?: boolean
  }

  // 1. Ownership check.
  await assertQuizOwnership(id, teacherId)

  // 2. Build update set conditionally.
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (body.title !== undefined) updateData.title = body.title
  if (body.description !== undefined) updateData.description = body.description
  if (body.lock_mode !== undefined) updateData.lockMode = body.lock_mode
  if (body.lock_until !== undefined)
    updateData.lockUntil = new Date(body.lock_until)
  if (body.allow_multiple_attempts !== undefined)
    updateData.allowMultipleAttempts = body.allow_multiple_attempts

  const [updated] = await db
    .update(quizzes)
    .set(updateData)
    .where(eq(quizzes.id, id))
    .returning()

  if (!updated) {
    throw AppError.notFound(
      'QUIZ_NOT_FOUND',
      'Quiz not found or not owned by you'
    )
  }

  res.status(200).json({ success: true, data: { quiz: updated } })
}

// ---------------------------------------------------------------------------
// POST /quizzes/:id/questions — add question
// ---------------------------------------------------------------------------

export const addQuestion = async (req: AuthenticatedRequest, res: Response) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const {
    question_text,
    question_type,
    options,
    correct_option_label,
    points,
    image_r2_key,
    position,
  } = req.body

  // 1. Ownership check.
  await assertQuizOwnership(id, teacherId)

  // 2. Insert the question. Unique constraint on (quizId, position)
  //    will throw on duplicate — we catch and translate to 409.
  let created: typeof quizQuestions.$inferSelect
  try {
    const [row] = await db
      .insert(quizQuestions)
      .values({
        quizId: id,
        questionText: question_text,
        questionType: question_type,
        options: options ?? null,
        correctOptionLabel: correct_option_label ?? null,
        points: points?.toString() ?? '1',
        imageR2Key: image_r2_key ?? null,
        position,
      })
      .returning()
    created = row
  } catch (err) {
    throw AppError.conflict(
      'POSITION_TAKEN',
      'A question already exists at that position in this quiz'
    )
  }

  res.status(201).json({ success: true, data: { question: created } })
}

// ---------------------------------------------------------------------------
// PATCH /quizzes/:id/questions/:qid — edit question (type immutable)
// ---------------------------------------------------------------------------

export const editQuestion = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { id, qid } = req.params
  const body = req.body as {
    question_type: 'mcq' | 'true_false' | 'written'
    question_text?: string
    options?: Record<string, string>
    correct_option_label?: 'A' | 'B' | 'C' | 'D'
    points?: number
    image_r2_key?: string | null
    position?: number
  }

  // 1. Ownership check.
  await assertQuizOwnership(id, teacherId)

  // 2. Verify question belongs to this quiz.
  const [existing] = await db
    .select({ id: quizQuestions.id })
    .from(quizQuestions)
    .where(
      and(eq(quizQuestions.id, qid), eq(quizQuestions.quizId, id))
    )
    .limit(1)

  if (!existing) {
    throw AppError.notFound(
      'QUESTION_NOT_FOUND',
      'Question not found in this quiz'
    )
  }

  // 3. Build update set — question_type is not updatable.
  const updateData: Record<string, unknown> = {}

  if (body.question_text !== undefined)
    updateData.questionText = body.question_text
  if (body.options !== undefined) updateData.options = body.options
  if (body.correct_option_label !== undefined)
    updateData.correctOptionLabel = body.correct_option_label
  if (body.points !== undefined) updateData.points = body.points.toString()
  if (body.image_r2_key !== undefined)
    updateData.imageR2Key = body.image_r2_key
  if (body.position !== undefined) updateData.position = body.position

  // Nothing to update beyond question_type (which is immutable).
  if (Object.keys(updateData).length === 0) {
    throw AppError.badRequest(
      'NO_CHANGES',
      'No updatable fields were provided'
    )
  }

  // 4. If position is changing, check for conflicts.
  if (body.position !== undefined) {
    const [conflict] = await db
      .select({ id: quizQuestions.id })
      .from(quizQuestions)
      .where(
        and(
          eq(quizQuestions.quizId, id),
          eq(quizQuestions.position, body.position)
        )
      )
      .limit(1)

    if (conflict && conflict.id !== qid) {
      throw AppError.conflict(
        'POSITION_TAKEN',
        'A question already exists at that position in this quiz'
      )
    }
  }

  const [updated] = await db
    .update(quizQuestions)
    .set(updateData)
    .where(eq(quizQuestions.id, qid))
    .returning()

  if (!updated) {
    throw AppError.notFound(
      'QUESTION_NOT_FOUND',
      'Question not found'
    )
  }

  res.status(200).json({ success: true, data: { question: updated } })
}

// ---------------------------------------------------------------------------
// DELETE /quizzes/:id/questions/:qid — delete question (hard delete)
// ---------------------------------------------------------------------------

export const deleteQuestion = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { id, qid } = req.params

  // 1. Ownership via subquery — only delete if the quiz belongs to a
  //    lecture owned by the caller.
  const [deleted] = await db
    .delete(quizQuestions)
    .where(
      and(
        eq(quizQuestions.id, qid),
        eq(quizQuestions.quizId, id),
        inArray(
          quizQuestions.quizId,
          db
            .select({ id: quizzes.id })
            .from(quizzes)
            .innerJoin(lectures, eq(quizzes.lectureId, lectures.id))
            .where(
              and(
                eq(lectures.teacherId, teacherId),
                isNull(lectures.deletedAt)
              )
            )
        )
      )
    )
    .returning({ id: quizQuestions.id })

  if (!deleted) {
    throw AppError.notFound(
      'QUESTION_NOT_FOUND',
      'Question not found or not owned by you'
    )
  }

  res.status(200).json({ success: true, data: { question: deleted } })
}

// ---------------------------------------------------------------------------
// PATCH /quizzes/:id/questions/reorder — reorder question positions
// ---------------------------------------------------------------------------

export const reorderQuestions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const { ordered_ids } = req.body

  // 1. Ownership check.
  await assertQuizOwnership(id, teacherId)

  // 2. Load all existing question IDs for this quiz.
  const existing = await db
    .select({ id: quizQuestions.id })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, id))

  const existingIds = new Set(existing.map((q) => q.id))

  // Verify ordered_ids contains exactly the set of existing question IDs.
  if (
    ordered_ids.length !== existingIds.size ||
    !ordered_ids.every((qid: string) => existingIds.has(qid))
  ) {
    throw AppError.badRequest(
      'INVALID_QUESTION_SET',
      'ordered_ids must contain exactly the set of existing question IDs'
    )
  }

  // 3. 2-phase position update to avoid UNIQUE conflicts.
  await db.transaction(async (tx) => {
    // Phase A: set all positions to negative temp values.
    for (let i = 0; i < ordered_ids.length; i++) {
      await tx
        .update(quizQuestions)
        .set({ position: -(i + 1) })
        .where(eq(quizQuestions.id, ordered_ids[i]))
    }

    // Phase B: set final positions.
    for (let i = 0; i < ordered_ids.length; i++) {
      await tx
        .update(quizQuestions)
        .set({ position: i + 1 })
        .where(eq(quizQuestions.id, ordered_ids[i]))
    }
  })

  res.status(200).json({ success: true })
}

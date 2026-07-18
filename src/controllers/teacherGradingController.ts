import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  quizzes,
  quizQuestions,
  quizAttempts,
  quizAnswers,
  lectures,
  students,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, asc, desc, eq, exists, isNull, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const offsetFor = (page: number, limit: number) => (page - 1) * limit

// ---------------------------------------------------------------------------
// GET /teacher/quiz-attempts — list attempts needing grading
// ---------------------------------------------------------------------------

export const listUngradedAttempts = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { page, limit, needs_grading } = req.query as unknown as {
    page: number
    limit: number
    needs_grading?: string
  }
  const offset = offsetFor(page, limit)

  // Compose all filter conditions into one 'where' clause using 'and' inside Drizzle.
  const where = and(
    eq(lectures.teacherId, teacherId),
    isNull(lectures.deletedAt),
    needs_grading === 'true'
      ? exists(
        db
          .select()
          .from(quizAnswers)
          .where(
            and(
              eq(quizAnswers.attemptId, quizAttempts.id),
              isNull(quizAnswers.pointsAwarded)
            )
          )
      )
      : undefined
  )

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: quizAttempts.id,
        quizId: quizAttempts.quizId,
        attemptNumber: quizAttempts.attemptNumber,
        status: quizAttempts.status,
        score: quizAttempts.score,
        submittedAt: quizAttempts.submittedAt,
        gradedAt: quizAttempts.gradedAt,
        studentId: students.id,
        studentName: students.name,
        studentEmail: students.email,
        quizTitle: quizzes.title,
        lectureTitle: lectures.title,
      })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
      .innerJoin(lectures, eq(quizzes.lectureId, lectures.id))
      .innerJoin(students, eq(quizAttempts.studentId, students.id))
      .where(where)
      .orderBy(desc(quizAttempts.submittedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
      .innerJoin(lectures, eq(quizzes.lectureId, lectures.id))
      .where(where),
  ])

  res.status(200).json({
    success: true,
    data: {
      attempts: rows.map((r) => ({
        id: r.id,
        quizId: r.quizId,
        quizTitle: r.quizTitle,
        lectureTitle: r.lectureTitle,
        student: {
          id: r.studentId,
          name: r.studentName,
          email: r.studentEmail,
        },
        attemptNumber: r.attemptNumber,
        status: r.status,
        score: r.score ? Number(r.score) : null,
        submittedAt: r.submittedAt,
        gradedAt: r.gradedAt,
      })),
    },
    meta: {
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit),
    },
  })
}

// ---------------------------------------------------------------------------
// POST /teacher/quiz-attempts/:id/grade — grade written answers
// ---------------------------------------------------------------------------

export const gradeAttempt = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const teacherId = req.user!.id
  const { id } = req.params
  const { grades } = req.body

  // 1. Load attempt + quiz + lecture, verify teacher ownership.
  const [attempt] = await db
    .select({
      id: quizAttempts.id,
      quizId: quizAttempts.quizId,
      status: quizAttempts.status,
      lectureTeacherId: lectures.teacherId,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .innerJoin(lectures, eq(quizzes.lectureId, lectures.id))
    .where(eq(quizAttempts.id, id))
    .limit(1)

  if (!attempt) {
    throw AppError.notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }

  if (attempt.lectureTeacherId !== teacherId) {
    throw AppError.notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }

  if (attempt.status !== 'submitted') {
    throw AppError.forbidden(
      'ATTEMPT_NOT_SUBMITTED',
      'Only submitted attempts can be graded'
    )
  }

  // Fetch all written questions and their answers for this attempt in one go.
  const writtenQuizAnswers = await db
    .select({
      answerId: quizAnswers.id,
      questionId: quizQuestions.id,
      questionType: quizQuestions.questionType,
      questionPoints: quizQuestions.points,
    })
    .from(quizAnswers)
    .innerJoin(quizQuestions, eq(quizAnswers.questionId, quizQuestions.id))
    .where(
      and(
        eq(quizAnswers.attemptId, id),
        eq(quizQuestions.quizId, attempt.quizId),
        eq(quizQuestions.questionType, 'written')
      )
    );

  // Build maps for validation and answer lookup.
  const writtenQuestionMap = new Map(
    writtenQuizAnswers.map((row) => [
      row.questionId,
      {
        questionType: row.questionType,
        points: row.questionPoints,
      },
    ])
  );
  const answerIdMap = new Map(
    writtenQuizAnswers.map((row) => [row.questionId, row.answerId])
  );

  const now = new Date();

  // 2. Process each grade entry in bulk.
  const updatesToApply: {
    answerId: string;
    pointsAwarded: string;
    teacherFeedback: string | null;
    gradedByTeacherId: string;
    gradedAt: Date;
  }[] = [];

  for (const grade of grades) {
    const question = writtenQuestionMap.get(grade.question_id);
    if (!question) {
      throw AppError.badRequest(
        'INVALID_GRADE_ENTRY',
        'Question not found in this quiz or is not a written question'
      );
    }

    if (question.questionType !== 'written') {
      throw AppError.badRequest(
        'INVALID_GRADE_ENTRY',
        'Only written questions can be manually graded'
      );
    }

    if (grade.points_awarded > Number(question.points)) {
      throw AppError.badRequest(
        'POINTS_EXCEED_MAX',
        `Points awarded cannot exceed ${question.points} for this question`
      );
    }

    const answerId = answerIdMap.get(grade.question_id);
    if (!answerId) {
      throw AppError.badRequest(
        'INVALID_GRADE_ENTRY',
        'No answer found for this question in this attempt'
      );
    }

    updatesToApply.push({
      answerId,
      pointsAwarded: grade.points_awarded.toString(),
      teacherFeedback: grade.teacher_feedback ?? null,
      gradedByTeacherId: teacherId,
      gradedAt: now,
    });
  }

  // Bulk update all answers.
  if (updatesToApply.length > 0) {
    await Promise.all(
      updatesToApply.map((update) =>
        db
          .update(quizAnswers)
          .set({
            pointsAwarded: update.pointsAwarded,
            teacherFeedback: update.teacherFeedback,
            gradedByTeacherId: update.gradedByTeacherId,
            gradedAt: update.gradedAt,
          })
          .where(eq(quizAnswers.id, update.answerId))
      )
    );
  }

  // 3. Check if all written answers are now graded.
  const [ungradedCount] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(quizAnswers)
    .innerJoin(quizQuestions, eq(quizAnswers.questionId, quizQuestions.id))
    .where(
      and(
        eq(quizAnswers.attemptId, id),
        eq(quizQuestions.questionType, 'written'),
        isNull(quizAnswers.pointsAwarded)
      )
    )

  let gradedAt: Date | null = null

  if (!ungradedCount || ungradedCount.count === 0) {
    // All written answers graded — compute total score.
    const allAnswers = updatesToApply
 
    const score = allAnswers.reduce(
      (sum, a) => sum + (a.pointsAwarded ? Number(a.pointsAwarded) : 0),
      0
    )

    gradedAt = now

    await db
      .update(quizAttempts)
      .set({
        score: score.toString(),
        gradedAt: now,
      })
      .where(eq(quizAttempts.id, id))
  }

  res.status(200).json({
    success: true,
    data: {
      gradedAt,
    },
  })
}

import type { Response } from 'express'
import { db } from '../db/connection.ts'
import {
  quizzes,
  quizQuestions,
  quizAttempts,
  quizAnswers,
  lectures,
  lecturePurchases,
} from '../db/schema.ts'
import { AppError } from '../utils/AppError.ts'
import type { AuthenticatedRequest } from '../types/authTypes.ts'
import { and, asc, eq, isNull, max, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loads a quiz joined with its lecture, verifying:
 *  - lecture is not soft-deleted
 *  - lecture is published
 *  - student has purchased the lecture
 *
 * Returns the quiz row on success, throws 404 / 403 on failure.
 */
const loadQuizForStudent = async (quizId: string, studentId: string) => {
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
      lectureStatus: lectures.status,
      lectureDeletedAt: lectures.deletedAt,
      purchaseId: lecturePurchases.id,
    })
    .from(quizzes)
    .innerJoin(lectures, eq(quizzes.lectureId, lectures.id))
    .leftJoin(
      lecturePurchases,
      and(
        eq(lecturePurchases.studentId, studentId),
        eq(lecturePurchases.lectureId, lectures.id)
      )
    )
    .where(eq(quizzes.id, quizId))
    .limit(1)

  if (!row) {
    throw AppError.notFound('QUIZ_NOT_FOUND', 'Quiz not found')
  }

  if (row.lectureDeletedAt) {
    throw AppError.notFound('QUIZ_NOT_FOUND', 'Quiz not found')
  }

  if (row.lectureStatus !== 'published') {
    throw AppError.notFound('QUIZ_NOT_FOUND', 'Quiz not found')
  }

  if (!row.purchaseId) {
    throw AppError.forbidden(
      'LECTURE_NOT_PURCHASED',
      'You must purchase this lecture to access the quiz'
    )
  }

  return row
}

// ---------------------------------------------------------------------------
// GET /student/quizzes/:id — quiz landing page
// ---------------------------------------------------------------------------

export const getStudentQuiz = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id
  const { id } = req.params

  const quiz = await loadQuizForStudent(id, studentId)

  // Count total questions.
  const [{ count: questionCount }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, id))

  // Load student's existing attempts for this quiz.
  const attempts = await db
    .select({
      id: quizAttempts.id,
      attemptNumber: quizAttempts.attemptNumber,
      status: quizAttempts.status,
      score: quizAttempts.score,
      startedAt: quizAttempts.startedAt,
      submittedAt: quizAttempts.submittedAt,
    })
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.quizId, id), eq(quizAttempts.studentId, studentId))
    )
    .orderBy(asc(quizAttempts.attemptNumber))

  res.status(200).json({
    success: true,
    data: {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        lockMode: quiz.lockMode,
        lockUntil: quiz.lockUntil,
        allowMultipleAttempts: quiz.allowMultipleAttempts,
        createdAt: quiz.createdAt,
      },
      questionCount,
      attempts: attempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        score: a.score ? Number(a.score) : null,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
      })),
    },
  })
}

// ---------------------------------------------------------------------------
// POST /student/quizzes/:id/attempts — start attempt
// ---------------------------------------------------------------------------

export const startAttempt = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id
  const { id } = req.params

  const quiz = await loadQuizForStudent(id, studentId)

  // Check quiz is not locked (calendar mode).
  if (
    quiz.lockMode === 'calendar' &&
    quiz.lockUntil &&
    new Date(quiz.lockUntil) <= new Date()
  ) {
    throw AppError.forbidden('QUIZ_LOCKED', 'This quiz is past its lock period')
  }

  const existingAttempts = await db
    .select({ attemptNumber: quizAttempts.attemptNumber })
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.quizId, id), eq(quizAttempts.studentId, studentId))
    );

  if (!quiz.allowMultipleAttempts && existingAttempts.length > 0) {
    throw AppError.forbidden(
      'MAX_ATTEMPTS_REACHED',
      'You have already attempted this quiz'
    );
  }

  const attemptNumber =
    (existingAttempts.length > 0
      ? Math.max(...existingAttempts.map((a) => a.attemptNumber))
      : 0) + 1;

  const [created] = await db
    .insert(quizAttempts)
    .values({
      quizId: id,
      studentId,
      attemptNumber,
      status: 'in_progress',
    })
    .returning();

  res.status(201).json({
    success: true,
    data: {
      attempt: {
        id: created.id,
        attemptNumber: created.attemptNumber,
        startedAt: created.startedAt,
        status: created.status,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /student/quiz-attempts/:id — in-progress view
// ---------------------------------------------------------------------------

export const getAttempt = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id
  const { id } = req.params

  // Load attempt with ownership check, and join answers in a single query.
  const attemptWithAnswers = await db
    .select({
      attempt: quizAttempts,
      answer: quizAnswers,
    })
    .from(quizAttempts)
    .leftJoin(quizAnswers, eq(quizAnswers.attemptId, quizAttempts.id))
    .where(and(eq(quizAttempts.id, id), eq(quizAttempts.studentId, studentId)))

  // attemptWithAnswers will be an array, so we need to extract attempt and answers
  const attempt = attemptWithAnswers[0]?.attempt

  if (!attempt) {
    throw AppError.notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }

  if (attempt.status !== 'in_progress') {
    throw AppError.forbidden(
      'ATTEMPT_NOT_IN_PROGRESS',
      'This attempt has already been submitted'
    )
  }

  // Load questions ordered by position (exclude correct_option_label).
  const questions = await db
    .select({
      id: quizQuestions.id,
      quizId: quizQuestions.quizId,
      questionText: quizQuestions.questionText,
      questionType: quizQuestions.questionType,
      options: quizQuestions.options,
      points: quizQuestions.points,
      imageR2Key: quizQuestions.imageR2Key,
      position: quizQuestions.position,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, attempt.quizId))
    .orderBy(asc(quizQuestions.position))

  // Collect all answers, filtering out nulls.
  const answers =
    attemptWithAnswers
      .map((row) => row.answer)
      .filter((row) => !!row)

  res.status(200).json({
    success: true,
    data: {
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt,
      },
      questions,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        selectedLabel: a.selectedLabel,
        writtenAnswerText: a.writtenAnswerText,
      })),
    },
  })
}

// ---------------------------------------------------------------------------
// POST /student/quiz-attempts/:id/submit — submit attempt
// ---------------------------------------------------------------------------

export const submitAttempt = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id
  const { id } = req.params
  const { answers } = req.body

  // Load attempt with ownership check.
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, id), eq(quizAttempts.studentId, studentId)))
    .limit(1)

  if (!attempt) {
    throw AppError.notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }

  if (attempt.status !== 'in_progress') {
    throw AppError.forbidden(
      'ATTEMPT_NOT_IN_PROGRESS',
      'This attempt has already been submitted'
    )
  }

  // Load quiz for lock check.
  const [quiz] = await db
    .select({ lockMode: quizzes.lockMode, lockUntil: quizzes.lockUntil})
    .from(quizzes)
    .where(eq(quizzes.id, attempt.quizId))
    .limit(1)

  if (
    quiz!.lockMode === 'calendar' &&
    quiz!.lockUntil &&
    new Date(quiz!.lockUntil) <= new Date()
  ) {
    throw AppError.forbidden('QUIZ_LOCKED', 'This quiz is past its lock period')
  }

  // Load all questions for the quiz.
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, attempt.quizId))

  const questionMap = new Map(questions.map((q) => [q.id, q]))

  // Validate and prepare answers, then insert them all at once.
  const answersToInsert = []

  for (const ans of answers) {
    const question = questionMap.get(ans.question_id)
    if (!question) {
      throw AppError.badRequest(
        'INVALID_QUESTION',
        'Answer references a question not in this quiz'
      )
    }

    // Auto-grade MCQ/TF.
    let isCorrect: boolean | null = null
    let pointsAwarded: number | null = null

    if (
      question.questionType === 'mcq' ||
      question.questionType === 'true_false'
    ) {
      isCorrect = ans.selected_label === question.correctOptionLabel
      pointsAwarded = isCorrect ? Number(question.points) : 0
    }

    answersToInsert.push({
      attemptId: id,
      questionId: ans.question_id,
      selectedLabel: ans.selected_label ?? null,
      writtenAnswerText: ans.written_answer_text ?? null,
      isCorrect,
      pointsAwarded: pointsAwarded !== null ? pointsAwarded.toString() : null,
    })
  }

  if (answersToInsert.length > 0) {
    await db.insert(quizAnswers).values(answersToInsert)
  }

  // Mark attempt as submitted.
  const now = new Date()
  const hasWritten = questions.some((q) => q.questionType === 'written')

  if (hasWritten) {
    // Written questions remain ungraded — score stays NULL.
    await db
      .update(quizAttempts)
      .set({ status: 'submitted', submittedAt: now })
      .where(eq(quizAttempts.id, id))
  } else {
    // All MCQ/TF — compute score now.
    const allAnswers = answersToInsert;

    const score = allAnswers.reduce(
      (sum, a) => sum + (a.pointsAwarded ? Number(a.pointsAwarded) : 0),
      0
    )

    await db
      .update(quizAttempts)
      .set({
        status: 'submitted',
        submittedAt: now,
        score: score.toString(),
        gradedAt: now,
      })
      .where(eq(quizAttempts.id, id))
  }

  res.status(200).json({
    success: true,
    data: {
      status: 'submitted',
      submittedAt: now,
    },
  })
}

// ---------------------------------------------------------------------------
// GET /student/quiz-attempts/:id/results — results view
// ---------------------------------------------------------------------------

export const getAttemptResults = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const studentId = req.user!.id
  const { id } = req.params

  // 1. Get attempt and quiz info in one join
  const [attemptWithQuiz] = await db
    .select({
      attempt: quizAttempts,
      quiz: quizzes,
    })
    .from(quizAttempts)
    .innerJoin(
      quizzes,
      eq(quizAttempts.quizId, quizzes.id)
    )
    .where(and(eq(quizAttempts.id, id), eq(quizAttempts.studentId, studentId)))
    .limit(1)

  if (!attemptWithQuiz) {
    throw AppError.notFound('ATTEMPT_NOT_FOUND', 'Attempt not found')
  }

  const attempt = attemptWithQuiz.attempt
  const quiz = attemptWithQuiz.quiz

  if (attempt.status !== 'submitted' && attempt.status !== 'graded') {
    throw AppError.forbidden(
      'ATTEMPT_NOT_SUBMITTED',
      'Results are only available after submission'
    )
  }

  // Check if results are visible.
  if (
    !attempt.gradedAt &&
    quiz.lockMode === 'calendar' &&
    quiz.lockUntil &&
    new Date(quiz.lockUntil) > new Date()
  ) {
    throw AppError.forbidden(
      'RESULTS_LOCKED',
      'Results are locked until the quiz lock period ends'
    )
  }

  if (!attempt.gradedAt) {
    throw AppError.forbidden(
      'NOT_YET_GRADED',
      'Results are not yet available — awaiting grading'
    )
  }

  // 2. Load all quiz questions along with the student's answers in one call (left join)
  const questionsWithAnswers = await db
    .select({
      question: quizQuestions,
      answer: quizAnswers,
    })
    .from(quizQuestions)
    .leftJoin(
      quizAnswers,
      and(
        eq(quizQuestions.id, quizAnswers.questionId),
        eq(quizAnswers.attemptId, id)
      )
    )
    .where(eq(quizQuestions.quizId, attempt.quizId))
    .orderBy(asc(quizQuestions.position))

  const questions = questionsWithAnswers.map((row) => row.question)
  const answers = questionsWithAnswers
  .map((row) => row.answer)
    .filter((row) => !!row)

  const answerMap = new Map(answers.map((a) => [a.questionId, a]))

  res.status(200).json({
    success: true,
    data: {
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        score: attempt.score ? Number(attempt.score) : null,
        submittedAt: attempt.submittedAt,
        gradedAt: attempt.gradedAt,
      },
      questions: questions.map((q) => {
        const answer = answerMap.get(q.id)
        return {
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options,
          correctOptionLabel: q.correctOptionLabel,
          points: Number(q.points),
          position: q.position,
          studentAnswer: answer
            ? {
              selectedLabel: answer.selectedLabel,
              writtenAnswerText: answer.writtenAnswerText,
              isCorrect: answer.isCorrect,
              pointsAwarded: answer.pointsAwarded
                ? Number(answer.pointsAwarded)
                : null,
              teacherFeedback: answer.teacherFeedback,
            }
            : null,
        }
      }),
    },
  })
}

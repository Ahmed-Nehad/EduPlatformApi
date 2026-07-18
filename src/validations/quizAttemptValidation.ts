import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared param schemas
// ---------------------------------------------------------------------------

const quizIdParam = z.object({
  id: z.uuid('Invalid quiz id'),
})

const attemptIdParam = z.object({
  id: z.uuid('Invalid attempt id'),
})

// ---------------------------------------------------------------------------
// GET /student/quizzes/:id — quiz landing page
// ---------------------------------------------------------------------------

export const getStudentQuizSchema = z.object({
  params: quizIdParam,
})

// ---------------------------------------------------------------------------
// POST /student/quizzes/:id/attempts — start attempt
// ---------------------------------------------------------------------------

export const startAttemptSchema = z.object({
  params: quizIdParam,
})

// ---------------------------------------------------------------------------
// GET /student/quiz-attempts/:id — in-progress view
// ---------------------------------------------------------------------------

export const getAttemptSchema = z.object({
  params: attemptIdParam,
})

// ---------------------------------------------------------------------------
// POST /student/quiz-attempts/:id/submit — submit answers
// ---------------------------------------------------------------------------

export const submitAttemptSchema = z.object({
  params: attemptIdParam,
  body: z.object({
    answers: z
      .array(
        z.object({
          question_id: z.uuid('Invalid question id'),
          selected_label: z.enum(['A', 'B', 'C', 'D']).optional(),
          written_answer_text: z.string().max(5000).optional(),
        })
      )
      .min(1, 'At least one answer is required'),
  }),
})

// ---------------------------------------------------------------------------
// GET /student/quiz-attempts/:id/results — results view
// ---------------------------------------------------------------------------

export const getAttemptResultsSchema = z.object({
  params: attemptIdParam,
})

// ---------------------------------------------------------------------------
// GET /teacher/quiz-attempts — list ungraded attempts
// ---------------------------------------------------------------------------

export const listUngradedSchema = z.object({
  query: z.object({
    needs_grading: z.literal('true').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }),
})

// ---------------------------------------------------------------------------
// POST /teacher/quiz-attempts/:id/grade — grade written answers
// ---------------------------------------------------------------------------

export const gradeAttemptSchema = z.object({
  params: attemptIdParam,
  body: z.object({
    grades: z
      .array(
        z.object({
          question_id: z.uuid('Invalid question id'),
          points_awarded: z.number().min(0),
          teacher_feedback: z.string().max(2000).optional(),
        })
      )
      .min(1, 'At least one grade entry is required'),
  }),
})

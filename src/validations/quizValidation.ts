import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const lectureIdField = z.uuid('Invalid lecture id')

const quizIdParam = z.object({
  id: z.uuid('Invalid quiz id'),
})

const questionIdParam = z.object({
  id: z.uuid('Invalid quiz id'),
  qid: z.uuid('Invalid question id'),
})

// ---------------------------------------------------------------------------
// POST /quizzes — create quiz
// ---------------------------------------------------------------------------

export const createQuizSchema = z.object({
  body: z
    .object({
      lecture_id: lectureIdField,
      title: z.string().min(1).max(200),
      description: z.string().max(5000).optional(),
      lock_mode: z
        .enum(['after_submission', 'calendar'])
        .default('after_submission'),
      lock_until: z.string().datetime().optional(),
      allow_multiple_attempts: z.boolean().default(false),
    })
    .refine(
      (d) => d.lock_mode !== 'calendar' || d.lock_until !== undefined,
      {
        message: 'lock_until is required when lock_mode is calendar',
        path: ['lock_until'],
      }
    ),
})

// ---------------------------------------------------------------------------
// GET /quizzes/:id — get quiz
// ---------------------------------------------------------------------------

export const getQuizSchema = z.object({
  params: quizIdParam,
})

// ---------------------------------------------------------------------------
// PATCH /quizzes/:id — update quiz (partial)
// ---------------------------------------------------------------------------

const updateQuizBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    lock_mode: z.enum(['after_submission', 'calendar']).optional(),
    lock_until: z.string().datetime().optional(),
    allow_multiple_attempts: z.boolean().optional(),
  })
  .refine(
    (d) => d.lock_mode !== 'calendar' || d.lock_until !== undefined,
    {
      message: 'lock_until is required when lock_mode is calendar',
      path: ['lock_until'],
    }
  )
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
    path: [],
  })

export const updateQuizSchema = z.object({
  params: quizIdParam,
  body: updateQuizBody,
})

// ---------------------------------------------------------------------------
// POST /quizzes/:id/questions — add question (discriminated union)
// ---------------------------------------------------------------------------

const mcqQuestion = z.object({
  question_text: z.string().min(1),
  question_type: z.literal('mcq'),
  options: z.record(z.string(), z.string()),
  correct_option_label: z.enum(['A', 'B', 'C', 'D']),
  points: z.coerce.number().min(0).default(1),
  image_r2_key: z.string().max(512).optional(),
  position: z.coerce.number().int().positive(),
})

const trueFalseQuestion = z.object({
  question_text: z.string().min(1),
  question_type: z.literal('true_false'),
  correct_option_label: z.enum(['A', 'B']),
  points: z.coerce.number().min(0).default(1),
  image_r2_key: z.string().max(512).optional(),
  position: z.coerce.number().int().positive(),
})

const writtenQuestion = z.object({
  question_text: z.string().min(1),
  question_type: z.literal('written'),
  points: z.coerce.number().min(0).default(1),
  image_r2_key: z.string().max(512).optional(),
  position: z.coerce.number().int().positive(),
})

const questionBody = z.discriminatedUnion('question_type', [
  mcqQuestion,
  trueFalseQuestion,
  writtenQuestion,
])

export const addQuestionSchema = z.object({
  params: quizIdParam,
  body: questionBody,
})

// ---------------------------------------------------------------------------
// PATCH /quizzes/:id/questions/:qid — edit question (partial, type immutable)
// ---------------------------------------------------------------------------

const editMcqBody = z
  .object({
    question_type: z.literal('mcq'),
    question_text: z.string().min(1).optional(),
    options: z.record(z.string(), z.string()).optional(),
    correct_option_label: z.enum(['A', 'B', 'C', 'D']).optional(),
    points: z.coerce.number().min(0).optional(),
    image_r2_key: z.string().max(512).nullable().optional(),
    position: z.coerce.number().int().positive().optional(),
  })
  .refine((d) => Object.keys(d).length > 1, {
    message: 'At least one field must be provided to update',
    path: [],
  })

const editTrueFalseBody = z
  .object({
    question_type: z.literal('true_false'),
    question_text: z.string().min(1).optional(),
    correct_option_label: z.enum(['A', 'B']).optional(),
    points: z.coerce.number().min(0).optional(),
    image_r2_key: z.string().max(512).nullable().optional(),
    position: z.coerce.number().int().positive().optional(),
  })
  .refine((d) => Object.keys(d).length > 1, {
    message: 'At least one field must be provided to update',
    path: [],
  })

const editWrittenBody = z
  .object({
    question_type: z.literal('written'),
    question_text: z.string().min(1).optional(),
    points: z.coerce.number().min(0).optional(),
    image_r2_key: z.string().max(512).nullable().optional(),
    position: z.coerce.number().int().positive().optional(),
  })
  .refine((d) => Object.keys(d).length > 1, {
    message: 'At least one field must be provided to update',
    path: [],
  })

const editQuestionBody = z.discriminatedUnion('question_type', [
  editMcqBody,
  editTrueFalseBody,
  editWrittenBody,
])

export const editQuestionSchema = z.object({
  params: questionIdParam,
  body: editQuestionBody,
})

// ---------------------------------------------------------------------------
// DELETE /quizzes/:id/questions/:qid — delete question
// ---------------------------------------------------------------------------

export const deleteQuestionSchema = z.object({
  params: questionIdParam,
})

// ---------------------------------------------------------------------------
// PATCH /quizzes/:id/questions/reorder — reorder questions
// ---------------------------------------------------------------------------

export const reorderQuestionsSchema = z.object({
  params: quizIdParam,
  body: z.object({
    ordered_ids: z.array(z.uuid('Invalid question id')).min(1),
  }),
})

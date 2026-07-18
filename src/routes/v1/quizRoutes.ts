import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import {
  createQuizSchema,
  getQuizSchema,
  updateQuizSchema,
  addQuestionSchema,
  editQuestionSchema,
  deleteQuestionSchema,
  reorderQuestionsSchema,
} from '../../validations/quizValidation.ts'
import {
  createQuiz,
  getQuiz,
  updateQuiz,
  addQuestion,
  editQuestion,
  deleteQuestion,
  reorderQuestions,
} from '../../controllers/quizController.ts'

const router = Router()

// All quiz routes require an authenticated session.
router.use(authenticate)

// --- Teacher quiz + question management -----------------------------------
const teacher = Router()
teacher.use(requireRole('teacher'))

teacher.post('/', validate(createQuizSchema), createQuiz)
teacher.get('/:id', validate(getQuizSchema), getQuiz)
teacher.patch('/:id', validate(updateQuizSchema), updateQuiz)
teacher.post('/:id/questions', validate(addQuestionSchema), addQuestion)
teacher.patch(
  '/:id/questions/reorder',
  validate(reorderQuestionsSchema),
  reorderQuestions
)
teacher.patch(
  '/:id/questions/:qid',
  validate(editQuestionSchema),
  editQuestion
)
teacher.delete(
  '/:id/questions/:qid',
  validate(deleteQuestionSchema),
  deleteQuestion
)

router.use(teacher)

export default router

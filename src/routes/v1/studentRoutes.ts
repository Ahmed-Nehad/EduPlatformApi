import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import {
  listMyDevicesSchema,
  createAccessRequestSchema,
  listMyTeachersSchema,
} from '../../validations/studentValidation.ts'
import {
  listMyDevices,
  createAccessRequest,
  listMyTeachers,
} from '../../controllers/studentController.ts'
import {
  purchaseLectureSchema,
  listPurchasesSchema,
} from '../../validations/purchaseValidation.ts'
import {
  purchaseLecture,
  listPurchases,
} from '../../controllers/purchaseController.ts'
import {
  getStudentQuizSchema,
  startAttemptSchema,
  getAttemptSchema,
  submitAttemptSchema,
  getAttemptResultsSchema,
} from '../../validations/quizAttemptValidation.ts'
import {
  getStudentQuiz,
  startAttempt,
  getAttempt,
  submitAttempt,
  getAttemptResults,
} from '../../controllers/studentQuizController.ts'

const router = Router()

// Every student endpoint requires an authenticated session AND the student
// role. The role guard runs after `authenticate`, so `req.user` is populated
// by the time the controllers run.
router.use(authenticate, requireRole('student'))

// GET    /student/devices                     — list my bound devices
// GET    /student/my-teachers                 — teachers who approved me
// POST   /student/access-requests/:teacherId  — request access to a teacher
// POST   /student/lectures/:id/buy            — purchase a lecture
// GET    /student/transactions                — list my transactions
router.get('/devices', validate(listMyDevicesSchema), listMyDevices)
router.get('/my-teachers', validate(listMyTeachersSchema), listMyTeachers)
router.post(
  '/access-requests/:teacherId',
  validate(createAccessRequestSchema),
  createAccessRequest
)
router.post('/lectures/:id/buy', validate(purchaseLectureSchema), purchaseLecture)
router.get('/transactions', validate(listPurchasesSchema), listPurchases)

// GET    /student/quizzes/:id                 — quiz landing page
// POST   /student/quizzes/:id/attempts        — start attempt
// GET    /student/quiz-attempts/:id           — in-progress view
// POST   /student/quiz-attempts/:id/submit    — submit attempt
// GET    /student/quiz-attempts/:id/results   — results view
router.get('/quizzes/:id', validate(getStudentQuizSchema), getStudentQuiz)
router.post('/quizzes/:id/attempts', validate(startAttemptSchema), startAttempt)
router.get('/quiz-attempts/:id', validate(getAttemptSchema), getAttempt)
router.post('/quiz-attempts/:id/submit', validate(submitAttemptSchema), submitAttempt)
router.get('/quiz-attempts/:id/results', validate(getAttemptResultsSchema), getAttemptResults)

export default router

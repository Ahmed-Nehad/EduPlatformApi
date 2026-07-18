import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import {
  listStudentsSchema,
  decideAccessRequestSchema,
  createLectureSchema,
  getTeacherLectureDetailSchema,
  updateLectureSchema,
  deleteLectureSchema,
  listLecturesSchema,
  addContentItemSchema,
  reorderContentSchema,
  removeContentItemSchema,
} from '../../validations/teacherValidation.ts'
import {
  listStudents,
  updateRequestAccessStatus,
  createLecture,
  getTeacherLectureDetail,
  updateLecture,
  deleteLecture,
  listLectures,
} from '../../controllers/teacherController.ts'
import {
  addContentItem,
  reorderContent,
  removeContentItem,
} from '../../controllers/teacherContentController.ts'
import { gradeAttemptSchema, listUngradedSchema } from '../../validations/quizAttemptValidation.ts'
import { gradeAttempt, listUngradedAttempts } from '../../controllers/teacherGradingController.ts'

const router = Router()

// Every teacher endpoint requires an authenticated session AND the teacher role.
router.use(authenticate, requireRole('teacher'))

// --- Access management ------------------------------------------------------
router.get('/students', validate(listStudentsSchema), listStudents)
router.patch('/access-requests/:userId', validate(decideAccessRequestSchema), updateRequestAccessStatus)

// --- Lecture CRUD -----------------------------------------------------------
router.post('/lectures', validate(createLectureSchema), createLecture)
router.get('/lectures', validate(listLecturesSchema), listLectures)
router.get('/lectures/:id', validate(getTeacherLectureDetailSchema), getTeacherLectureDetail)
router.patch('/lectures/:id', validate(updateLectureSchema), updateLecture)
router.delete('/lectures/:id', validate(deleteLectureSchema), deleteLecture)

// --- Content ordering ------------------------------------------------------
router.post('/lectures/:id/content', validate(addContentItemSchema), addContentItem)
router.patch('/lectures/:id/content', validate(reorderContentSchema), reorderContent)
router.delete(
  '/lectures/:id/content/:itemId',
  validate(removeContentItemSchema),
  removeContentItem
)

router.get('/quiz-attempts', validate(listUngradedSchema), listUngradedAttempts)
router.post(
  '/quiz-attempts/:id/grade',
  validate(gradeAttemptSchema),
  gradeAttempt
)

export default router

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

const router = Router()

// Every student endpoint requires an authenticated session AND the student
// role. The role guard runs after `authenticate`, so `req.user` is populated
// by the time the controllers run.
router.use(authenticate, requireRole('student'))

// GET    /student/devices                     — list my bound devices
// GET    /student/my-teachers                 — teachers who approved me
// POST   /student/access-requests/:teacherId  — request access to a teacher
router.get('/devices', validate(listMyDevicesSchema), listMyDevices)
router.get('/my-teachers', validate(listMyTeachersSchema), listMyTeachers)
router.post(
  '/access-requests/:teacherId',
  validate(createAccessRequestSchema),
  createAccessRequest
)

export default router

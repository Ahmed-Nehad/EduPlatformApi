import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import { listStudentsSchema, decideAccessRequestSchema } from '../../validations/teacherValidation.ts'
import { listStudents, updateRequestAccessStatus } from '../../controllers/teacherController.ts'

const router = Router()

// Every teacher endpoint requires an authenticated session AND the teacher role.
router.use(authenticate, requireRole('teacher'))

router.get('/students', validate(listStudentsSchema), listStudents)
router.patch('/access-requests/:userId', validate(decideAccessRequestSchema), updateRequestAccessStatus)

export default router

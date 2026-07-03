import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import {
  createTeacherSchema,
  listTeachersSchema,
  listStudentsSchema,
  deviceIdParamSchema,
  studentIdParamSchema,
  updateTeacherSchema,
  updateStudentSchema,
} from '../../validations/adminValidation.ts'
import {
  createTeacher,
  listTeachers,
  listStudents,
  revokeDevice,
  listStudentDevices,
  patchTeacher,
  patchStudent,
} from '../../controllers/adminController.ts'

const router = Router()

// Every admin endpoint requires an authenticated session AND the admin role.
router.use(authenticate, requireRole('admin'))

// --- Teachers ---------------------------------------------------------------
// POST   /admin/teachers        — create a teacher account
// GET    /admin/teachers        — list all teachers (paginated)
// PATCH  /admin/teachers/:id    — update a teacher account
router.post('/teachers', validate(createTeacherSchema), createTeacher)
router.get('/teachers', validate(listTeachersSchema), listTeachers)
router.patch('/teachers/:id', validate(updateTeacherSchema), patchTeacher)

// --- Students ----------------------------------------------------------------
// GET    /admin/students              — list all students (paginated)
// GET    /admin/students/:id/devices  — list all devices linked to a student
// PATCH  /admin/students/:id          — update a student account
router.get('/students', validate(listStudentsSchema), listStudents)
router.get('/students/:id/devices', validate(studentIdParamSchema), listStudentDevices)
router.patch('/students/:id', validate(updateStudentSchema), patchStudent)

// --- Devices -----------------------------------------------------------------
// DELETE /admin/devices/:id     — force-revoke a student device (frees a slot)
router.delete('/devices/:id', validate(deviceIdParamSchema), revokeDevice)

export default router

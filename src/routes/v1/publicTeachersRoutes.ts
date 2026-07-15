import { Router } from 'express'
import { validate } from '../../middleware/validation.ts'
import { listTeacherLecturesSchema, listTeachersCatalogSchema } from '../../validations/purchaseValidation.ts'
import { listTeacherLectures, listTeachersCatalog } from '../../controllers/lectureController.ts'

const router = Router()

// Public teacher catalog, no auth required.
// Registered before /:id so Express doesn't match "teachers" as a UUID param.
router.get('/', validate(listTeachersCatalogSchema), listTeachersCatalog)
router.get('/:id/lectures', validate(listTeacherLecturesSchema), listTeacherLectures) 

export default router

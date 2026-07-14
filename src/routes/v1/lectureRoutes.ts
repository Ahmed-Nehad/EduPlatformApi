import { Router } from 'express'
import { validate } from '../../middleware/validation.ts'
import {
  listLecturesCatalogSchema,
  getLectureDetailSchema,
} from '../../validations/lectureValidation.ts'
import {
  listLecturesCatalog,
  getLectureDetail,
} from '../../controllers/lectureController.ts'

const router = Router()

// Public lecture catalog — no auth required. Any caller (including
// anonymous) gets the same result.
router.get('/', validate(listLecturesCatalogSchema), listLecturesCatalog)
router.get('/:id', validate(getLectureDetailSchema), getLectureDetail)

export default router

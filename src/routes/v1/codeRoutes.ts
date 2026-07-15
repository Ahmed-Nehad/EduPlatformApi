import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import {
  createCodeSchema,
  listCodesSchema,
  deleteCodeSchema,
} from '../../validations/codeValidation.ts'
import { createCode, listCodes, deleteCode } from '../../controllers/codeController.ts'

const router = Router()

// All code routes require an authenticated session + teacher role.
router.use(authenticate, requireRole('teacher'))

router.post('/', validate(createCodeSchema), createCode)
router.get('/', validate(listCodesSchema), listCodes)
router.delete('/:id', validate(deleteCodeSchema), deleteCode)

export default router

import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authMiddleware.ts'
import { validate } from '../../middleware/validation.ts'
import {
  redeemCodeSchema,
  getBalanceSchema,
  listTransactionsSchema,
} from '../../validations/walletValidation.ts'
import {
  redeemCode,
  getBalance,
  listTransactions,
} from '../../controllers/walletController.ts'

const router = Router()

// All wallet routes require an authenticated session + student role.
router.use(authenticate, requireRole('student'))

router.post('/redeem', validate(redeemCodeSchema), redeemCode)
router.get('/balance', validate(getBalanceSchema), getBalance)
router.get('/transactions', validate(listTransactionsSchema), listTransactions)

export default router

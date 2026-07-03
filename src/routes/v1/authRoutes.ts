import { Router } from 'express'
import { validate } from '../../middleware/validation.ts'
import { authenticate } from '../../middleware/authMiddleware.ts'
import { authIpRateLimiter } from '../../middleware/rateLimiter.ts'
import {
  registerSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from '../../validations/authValidation.ts'
import {
  register,
  login,
  logout,
  me,
  passwordResetRequest,
  passwordReset,
  verifyEmail,
  resendVerification,
} from '../../controllers/authController.ts'

const router = Router()

// --- Public ---------------------------------------------------------------
// Stricter, Redis-backed limiter on auth endpoints to mitigate brute-force /
// credential-stuffing attacks. Keyed on IP (+ email when available).
router.post('/register', authIpRateLimiter, validate(registerSchema), register)
router.post('/login', authIpRateLimiter, validate(loginSchema), login)
router.post('/password-reset-request', authIpRateLimiter, validate(passwordResetRequestSchema), passwordResetRequest)
router.post('/password-reset', authIpRateLimiter, validate(passwordResetSchema), passwordReset)
router.post('/verify-email', authIpRateLimiter, validate(verifyEmailSchema), verifyEmail)
router.post('/resend-verification', authIpRateLimiter, validate(resendVerificationSchema), resendVerification)

// --- Any authenticated user ----------------------------------------------
router.post('/logout', authenticate, logout)
router.get('/me', authenticate, me)

export default router

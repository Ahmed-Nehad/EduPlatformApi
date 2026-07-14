import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------
const emailField = z.email('Invalid email address').max(120)
const passwordField = z.string().min(8, 'Password must be at least 8 characters').max(128)
const nameField = z.string().min(2, 'Name must be at least 2 characters').max(120)
const deviceFingerprintField = z
  .string()
  .min(8, 'device_fingerprint is required')
  .max(255)
  .regex(/^sha256:.+$/, 'device_fingerprint must be in the form "sha256:<hash>"')
const deviceLabelField = z.string().min(1).max(120).optional()

// ---------------------------------------------------------------------------
// POST /auth/register  (student sign-up)
// ---------------------------------------------------------------------------
export const registerSchema = z.object({
  body: z.object({
    name: nameField,
    email: emailField,
    password: passwordField,
  }),
})

// ---------------------------------------------------------------------------
// POST /auth/login  (universal login)
// ---------------------------------------------------------------------------
export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    password: z.string().min(1, 'Password is required').max(128),
    // Students must supply a device fingerprint; teachers/admins do not.
    device_fingerprint: deviceFingerprintField.optional(),
    device_label: deviceLabelField,
  }),
})

// ---------------------------------------------------------------------------
// POST /auth/password-reset-request
// ---------------------------------------------------------------------------
export const passwordResetRequestSchema = z.object({
  body: z.object({
    email: emailField,
  }),
})

// ---------------------------------------------------------------------------
// POST /auth/password-reset
// ---------------------------------------------------------------------------
export const passwordResetSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
    password: passwordField,
  }),
})

// ---------------------------------------------------------------------------
// POST /auth/verify-email
// ---------------------------------------------------------------------------
export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
})

// ---------------------------------------------------------------------------
// POST /auth/resend-verification
// ---------------------------------------------------------------------------
export const resendVerificationSchema = z.object({
  body: z.object({
    email: emailField,
  }),
})

import type { Response } from 'express'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/connection.ts'
import {
  students,
  teachers,
  admins,
  studentDevices,
  passwordResetTokens,
  emailVerificationTokens,
} from '../db/schema.ts'
import { hashPassword, comparePassword } from '../utils/password.ts'
import { AppError } from '../utils/AppError.ts'
import { generateTokenPair, hashToken } from '../utils/tokens.ts'
import {
  createSession,
  destroySession,
  destroyAllUserSessions,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../services/sessionService.ts'
import {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} from '../services/emailService.ts'
import { env } from '../../env.ts'
import type { AuthenticatedRequest, SessionUser, UserRole } from '../types/authTypes.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_DEVICES_PER_STUDENT = 2

/** Builds the role-agnostic user object stored in the session. */
const toSessionUser = (
  row: { id: string; name: string; email: string },
  role: UserRole
): SessionUser => ({ id: row.id, name: row.name, email: row.email, role })

/**
 * Looks up a user across the role tables and returns the matching row plus its
 * role. Used by the universal login endpoint.
 *
 * Queries run sequentially with short-circuit evaluation: we stop as soon as a
 * match is found. This avoids two unnecessary queries on the common path
 * (students are the most frequent role) and is resilient to transient
 * connection errors on a single table.
 */
const findUserByEmail = async (
  email: string
): Promise<{
  user: SessionUser
  passwordHash: string
  isActive: boolean | null
  emailVerifiedAt: Date | null
} | null> => {
  const [student] = await db
    .select()
    .from(students)
    .where(eq(students.email, email))
    .limit(1)
  if (student) {
    return {
      user: toSessionUser(student, 'student'),
      passwordHash: student.passwordHash,
      isActive: student.isActive,
      emailVerifiedAt: student.emailVerifiedAt,
    }
  }

  const [teacher] = await db
    .select()
    .from(teachers)
    .where(eq(teachers.email, email))
    .limit(1)
  if (teacher) {
    return {
      user: toSessionUser(teacher, 'teacher'),
      passwordHash: teacher.passwordHash,
      isActive: teacher.isActive,
      emailVerifiedAt: null,
    }
  }

  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email))
    .limit(1)
  if (admin) {
    return {
      user: toSessionUser(admin, 'admin'),
      passwordHash: admin.passwordHash,
      isActive: null,
      emailVerifiedAt: null,
    }
  }

  return null
}

/**
 * Resolves the device binding for a student login.
 *
 * - If the fingerprint already exists (active) → reuse it, refresh lastSeenAt.
 * - If it's new and a free slot exists → bind to slot 1 or 2.
 * - If both slots are full → throws DEVICE_LIMIT_REACHED.
 *
 * Returns the device row id.
 */
const resolveStudentDevice = async (
  studentId: string,
  fingerprint: string,
  label: string | undefined
): Promise<string> => {
  // 1. Existing active device with this fingerprint?
  const [existing] = await db
    .select()
    .from(studentDevices)
    .where(
      and(
        eq(studentDevices.studentId, studentId),
        eq(studentDevices.deviceFingerprint, fingerprint),
        isNull(studentDevices.revokedAt)
      )
    )
    .limit(1)

  if (existing) {
    await db
      .update(studentDevices)
      .set({ lastSeenAt: new Date(), deviceLabel: label ?? existing.deviceLabel })
      .where(eq(studentDevices.id, existing.id))
    return existing.id
  }

  // 2. Find active slots to determine the next free slot number.
  const activeDevices = await db
    .select({ slotNumber: studentDevices.slotNumber })
    .from(studentDevices)
    .where(
      and(
        eq(studentDevices.studentId, studentId),
        isNull(studentDevices.revokedAt)
      )
    )

  if (activeDevices.length >= MAX_DEVICES_PER_STUDENT) {
    throw AppError.forbidden(
      'DEVICE_LIMIT_REACHED',
      'You have reached the maximum of 2 bound devices. Revoke one to continue.'
    )
  }

  const takenSlots = new Set(activeDevices.map((d) => d.slotNumber))
  const nextSlot = [1, 2].find((s) => !takenSlots.has(s))!

  // 3. Bind to the free slot. The unique(student_id, slot_number) constraint
  //    guarantees no race produces a duplicate slot.
  const [created] = await db
    .insert(studentDevices)
    .values({
      studentId,
      deviceFingerprint: fingerprint,
      deviceLabel: label,
      slotNumber: nextSlot,
    })
    .returning({ id: studentDevices.id })

  return created.id
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/** POST /auth/register — student sign-up */
export const register = async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, password } = req.body

  const [existing] = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.email, email))
    .limit(1)

  if (existing) {
    throw AppError.conflict('EMAIL_TAKEN', 'A student with this email already exists')
  }

  const passwordHash = await hashPassword(password)
  const [created] = await db
    .insert(students)
    .values({ name, email, passwordHash })
    .returning({
      id: students.id,
      name: students.name,
      email: students.email,
      role: sql<'student'>`'student'`.as('role'),
    })

  // Issue a verification token. A failure here is a real error (the student
  // would be left with no way to verify), so we let it propagate to the
  // global error handler rather than silently returning 201.
  const { token, tokenHash } = generateTokenPair()
  const expiresAt = new Date(
    Date.now() + env.EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000
  )
  await db.insert(emailVerificationTokens).values({
    studentId: created.id,
    tokenHash,
    expiresAt,
  })

  // Email delivery is best-effort: the student can request a new link via
  // /resend-verification, so a transport failure must not fail registration.
  const verifyUrl = `${env.APP_BASE_URL}/verify-email?token=${token}`
  sendEmailVerificationEmail(created.email, verifyUrl).catch((err) => {
    console.error('[register] failed to send verification email', err)
  })

  res.status(201).json({
    success: true,
    data: {
      user: created,
    },
  })
}

/** POST /auth/login — universal login (returns role-specific user object) */
export const login = async (req: AuthenticatedRequest, res: Response) => {
  const { email, password, device_fingerprint, device_label } = req.body

  const found = await findUserByEmail(email)
  if (!found) {
    throw AppError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password')
  }

  const { user, passwordHash, isActive, emailVerifiedAt } = found

  const valid = await comparePassword(password, passwordHash)
  if (!valid) {
    throw AppError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password')
  }

  // Active-account gate (students & teachers only)
  if (isActive === false) {
    throw AppError.forbidden('ACCOUNT_DISABLED', 'This account has been disabled')
  }

  // Email verification gate (students only)
  if (user.role === 'student' && !emailVerifiedAt) {
    throw AppError.forbidden(
      'EMAIL_NOT_VERIFIED',
      'Please verify your email address before logging in'
    )
  }

  // Device binding is only enforced for students.
  let deviceId: string | undefined
  if (user.role === 'student') {
    if (!device_fingerprint) {
      throw AppError.badRequest(
        'DEVICE_FINGERPRINT_REQUIRED',
        'device_fingerprint is required for student login'
      )
    }
    deviceId = await resolveStudentDevice(user.id, device_fingerprint, device_label)
  }

  const { sessionId, session } = await createSession(user, deviceId)
  res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions())

  res.status(200).json({
    success: true,
    data: {
      user: { id: user.id, name: user.name, role: user.role },
      ...(deviceId ? { device_id: deviceId } : {}),
      expires_at: session.expiresAt,
    },
  })
}

/** POST /auth/logout — destroys Redis session; clears cookie */
export const logout = async (req: AuthenticatedRequest, res: Response) => {
  const sessionId = req.sessionId
  const userId = req.user?.id

  if (sessionId) {
    await destroySession(sessionId, userId)
  }

  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
  res.status(200).json({ success: true, data: null })
}

/** GET /auth/me — current user profile */
export const me = async (req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ success: true, data: { user: req.user } })
}

/** POST /auth/password-reset-request — sends reset email to student */
export const passwordResetRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { email } = req.body

  const [student] = await db
    .select({ id: students.id, email: students.email })
    .from(students)
    .where(eq(students.email, email))
    .limit(1)

  // Always return success to avoid email enumeration, even if not found.
  if (student) {
    const { token, tokenHash } = generateTokenPair()
    const expiresAt = new Date(
      Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000
    )

    await db.insert(passwordResetTokens).values({
      studentId: student.id,
      tokenHash,
      expiresAt,
    })

    const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${token}`
    sendPasswordResetEmail(student.email, resetUrl).catch((err) => {
      console.error('[password reset request] failed to send reset password email', err)
    })
  }

  res.status(200).json({
    success: true,
    data: {
      message: 'If an account exists for that email, a reset link has been sent.',
    },
  })
}

/** POST /auth/password-reset — consumes token, sets new password */
export const passwordReset = async (req: AuthenticatedRequest, res: Response) => {
  const { token, password } = req.body

  const tokenHash = hashToken(token)

  // Look up an unused, unexpired token row.
  const [resetRow] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1)

  if (
    !resetRow ||
    resetRow.usedAt ||
    new Date(resetRow.expiresAt) < new Date()
  ) {
    throw AppError.badRequest(
      'INVALID_OR_EXPIRED_TOKEN',
      'The reset token is invalid or has expired'
    )
  }

  const passwordHash = await hashPassword(password)

  await db.transaction(async (tx) => {
    // First, update the student's password
    await tx
      .update(students)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(students.id, resetRow.studentId))

    // Then, mark the token as used (instead of deleting), to prevent reuse but keep for audit/history
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, resetRow.id))
  })

  // Invalidate all active sessions for this student.
  await destroyAllUserSessions(resetRow.studentId)

  res.status(200).json({
    success: true,
    data: { message: 'Password has been reset successfully.' },
  })
}

/** POST /auth/verify-email — consumes token, marks the student's email verified */
export const verifyEmail = async (req: AuthenticatedRequest, res: Response) => {
  const { token } = req.body

  const tokenHash = hashToken(token)

  // Look up an unused, unexpired token row.
  const [verifyRow] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1)

  if (
    !verifyRow ||
    verifyRow.usedAt ||
    new Date(verifyRow.expiresAt) < new Date()
  ) {
    throw AppError.badRequest(
      'INVALID_OR_EXPIRED_TOKEN',
      'The verification token is invalid or has expired'
    )
  }

  await db.transaction(async (tx) => {
    // Mark the student's email as verified.
    await tx
      .update(students)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(students.id, verifyRow.studentId))

    // Mark the token as used to prevent reuse (kept for audit/history).
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationTokens.id, verifyRow.id))
  })

  res.status(200).json({
    success: true,
    data: { message: 'Email verified successfully. You can now log in.' },
  })
}

/** POST /auth/resend-verification — issues a fresh verification link */
export const resendVerification = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { email } = req.body

  const [student] = await db
    .select({ id: students.id, email: students.email, emailVerifiedAt: students.emailVerifiedAt })
    .from(students)
    .where(eq(students.email, email))
    .limit(1)

  // Always return success to avoid email enumeration, even if not found or
  // already verified. We only send when a student exists and is unverified.
  if (student && !student.emailVerifiedAt) {
    const { token, tokenHash } = generateTokenPair()
    const expiresAt = new Date(
      Date.now() + env.EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000
    )
    await db.insert(emailVerificationTokens).values({
      studentId: student.id,
      tokenHash,
      expiresAt,
    })

    const verifyUrl = `${env.APP_BASE_URL}/verify-email?token=${token}`
    await sendEmailVerificationEmail(student.email, verifyUrl)
  }

  res.status(200).json({
    success: true,
    data: {
      message:
        'If an account exists for that email and is unverified, a verification link has been sent.',
    },
  })
}

/** GET /auth/devices — list my 2 bound devices (student only) */
export const listDevices = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id

  const devices = await db
    .select({
      id: studentDevices.id,
      device_fingerprint: studentDevices.deviceFingerprint,
      device_label: studentDevices.deviceLabel,
      slot_number: studentDevices.slotNumber,
      bound_at: studentDevices.boundAt,
      last_seen_at: studentDevices.lastSeenAt,
      revoked_at: studentDevices.revokedAt,
    })
    .from(studentDevices)
    .where(eq(studentDevices.studentId, userId))
    .orderBy(studentDevices.slotNumber)

  res.status(200).json({ success: true, data: { devices } })
}
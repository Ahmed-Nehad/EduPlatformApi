import { describe, it, expect, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createStudent,
  createTeacher,
  createAdmin,
  fingerprint,
} from '../helpers/factories.ts'
import { db } from '../../src/db/connection.ts'
import {
  studentDevices,
  passwordResetTokens,
  emailVerificationTokens,
  students,
} from '../../src/db/schema.ts'
import { hashToken } from '../../src/utils/tokens.ts'

const BASE = '/v1/auth'

describe('Auth routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // POST /auth/register
  // -------------------------------------------------------------------------
  describe('POST /auth/register', () => {
    it('creates a student and returns 201', async () => {
      const res = await api().post(`${BASE}/register`).send({
        name: 'New Student',
        email: 'newstudent@test.edu',
        password: 'Password123!',
      })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toMatchObject({
        name: 'New Student',
        email: 'newstudent@test.edu',
        role: 'student',
      })
      expect(res.body.data.user.id).toBeTruthy()
    })

    it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
      const existing = await createStudent({ email: 'dup@test.edu' })

      const res = await api().post(`${BASE}/register`).send({
        name: 'Another',
        email: existing.email,
        password: 'Password123!',
      })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('EMAIL_TAKEN')
    })

    it('rejects invalid input with 400 VALIDATION_ERROR', async () => {
      const res = await api().post(`${BASE}/register`).send({
        name: 'X',
        email: 'not-an-email',
        password: 'short',
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------
  describe('POST /auth/login', () => {
    it('logs in a student and sets a session cookie', async () => {
      const student = await createStudent()

      const res = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
        device_label: 'Chrome 126 / Windows 11',
      })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toMatchObject({
        id: student.id,
        name: student.name,
        role: 'student',
      })
      expect(res.body.data.device_id).toBeTruthy()
      expect(res.body.data.expires_at).toBeTruthy()
      // Cookie should be set
      expect(res.headers['set-cookie']).toBeDefined()
    })

    it('logs in a teacher without device_fingerprint', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)

      const res = await api().post(`${BASE}/login`).send({
        email: teacher.email,
        password: teacher.password,
      })

      expect(res.status).toBe(200)
      expect(res.body.data.user.role).toBe('teacher')
      expect(res.body.data.device_id).toBeUndefined()
    })

    it('logs in an admin without device_fingerprint', async () => {
      const admin = await createAdmin()

      const res = await api().post(`${BASE}/login`).send({
        email: admin.email,
        password: admin.password,
      })

      expect(res.status).toBe(200)
      expect(res.body.data.user.role).toBe('admin')
    })

    it('returns 401 INVALID_CREDENTIALS for wrong password', async () => {
      const student = await createStudent()

      const res = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: 'wrong-password',
        device_fingerprint: fingerprint('device1'),
      })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('returns 401 for non-existent email (no enumeration)', async () => {
      const res = await api().post(`${BASE}/login`).send({
        email: 'nobody@test.edu',
        password: 'Password123!',
        device_fingerprint: fingerprint('device1'),
      })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('requires device_fingerprint for students', async () => {
      const student = await createStudent()

      const res = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('DEVICE_FINGERPRINT_REQUIRED')
    })

    it('reuses existing device slot on repeat login (same fingerprint)', async () => {
      const student = await createStudent()
      const fp = fingerprint('device1')

      const first = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fp,
        device_label: 'Chrome / Windows',
      })
      const firstDeviceId = first.body.data.device_id

      const second = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fp,
        device_label: 'Chrome / Windows',
      })

      expect(second.status).toBe(200)
      // Same device row reused, not a new one.
      expect(second.body.data.device_id).toBe(firstDeviceId)

      const devices = await db
        .select()
        .from(studentDevices)
        .where(eq(studentDevices.studentId, student.id))
      expect(devices).toHaveLength(1)
    })

    it('binds a second device to slot 2', async () => {
      const student = await createStudent()

      await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })
      await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device2'),
      })

      const devices = await db
        .select()
        .from(studentDevices)
        .where(eq(studentDevices.studentId, student.id))
      expect(devices).toHaveLength(2)
      expect(devices.map((d) => d.slotNumber).sort()).toEqual([1, 2])
    })

    it('returns 403 DEVICE_LIMIT_REACHED when 2 slots are full', async () => {
      const student = await createStudent()

      await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })
      await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device2'),
      })

      const res = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device3'),
      })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('DEVICE_LIMIT_REACHED')
    })

    it('blocks disabled student accounts with 403 ACCOUNT_DISABLED', async () => {
      const student = await createStudent({ isActive: false })

      const res = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED')
    })
  })

  // -------------------------------------------------------------------------
  // GET /auth/me  &  POST /auth/logout
  // -------------------------------------------------------------------------
  describe('Authenticated endpoints (me, logout)', () => {
    it('GET /auth/me returns the logged-in user', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/me`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.user).toMatchObject({
        id: student.id,
        role: 'student',
      })
    })

    it('GET /auth/me returns 401 without a session', async () => {
      const res = await api().get(`${BASE}/me`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('POST /auth/logout destroys the session and clears the cookie', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const logoutRes = await api()
        .post(`${BASE}/logout`)
        .set(cookieHeader(cookie))
      expect(logoutRes.status).toBe(200)
      expect(logoutRes.body.success).toBe(true)

      // After logout, /me should be unauthorized even with the old cookie.
      const meRes = await api().get(`${BASE}/me`).set(cookieHeader(cookie))
      expect(meRes.status).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  // Password reset flow
  // -------------------------------------------------------------------------
  describe('Password reset', () => {
    it('POST /auth/password-reset-request always returns success (no enumeration)', async () => {
      const student = await createStudent()

      const knownRes = await api()
        .post(`${BASE}/password-reset-request`)
        .send({ email: student.email })

      const unknownRes = await api()
        .post(`${BASE}/password-reset-request`)
        .send({ email: 'nonexistent@test.edu' })

      expect(knownRes.status).toBe(200)
      expect(knownRes.body.success).toBe(true)
      expect(unknownRes.status).toBe(200)
      expect(unknownRes.body.success).toBe(true)

      // A token row should only exist for the known student.
      const tokens = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.studentId, student.id))
      expect(tokens).toHaveLength(1)
    })

    it('POST /auth/password-reset consumes a valid token and updates the password', async () => {
      const student = await createStudent()

      // Request reset.
      await api()
        .post(`${BASE}/password-reset-request`)
        .send({ email: student.email })

      // Grab the raw token hash from the DB and reverse-engineer is not possible,
      // so we insert a known token directly for a deterministic test.
      const rawToken = 'test-raw-token-for-deterministic-test'
      await db.insert(passwordResetTokens).values({
        studentId: student.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      })

      const res = await api().post(`${BASE}/password-reset`).send({
        token: rawToken,
        password: 'BrandNewPass123!',
      })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // The token should be marked used.
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, hashToken(rawToken)))
      expect(row.usedAt).not.toBeNull()

      // The student can now log in with the new password.
      const loginRes = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: 'BrandNewPass123!',
        device_fingerprint: fingerprint('device1'),
      })
      expect(loginRes.status).toBe(200)
    })

    it('POST /auth/password-reset rejects an invalid token', async () => {
      const res = await api().post(`${BASE}/password-reset`).send({
        token: 'bogus-token',
        password: 'BrandNewPass123!',
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN')
    })

    it('POST /auth/password-reset rejects an expired token', async () => {
      const student = await createStudent()
      const rawToken = 'expired-test-token'
      await db.insert(passwordResetTokens).values({
        studentId: student.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
      })

      const res = await api().post(`${BASE}/password-reset`).send({
        token: rawToken,
        password: 'BrandNewPass123!',
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN')
    })
  })

  // -------------------------------------------------------------------------
  // Email verification flow
  // -------------------------------------------------------------------------
  describe('Email verification', () => {
    it('POST /auth/register issues a verification token row', async () => {
      const res = await api().post(`${BASE}/register`).send({
        name: 'Verify Me',
        email: 'verifyme@test.edu',
        password: 'Password123!',
      })

      expect(res.status).toBe(201)

      const tokens = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.studentId, res.body.data.user.id))
      expect(tokens).toHaveLength(1)
      expect(tokens[0].usedAt).toBeNull()
    })

    it('POST /auth/login blocks unverified students with 403 EMAIL_NOT_VERIFIED', async () => {
      const student = await createStudent({ emailVerified: false })

      const res = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
    })

    it('POST /auth/verify-email consumes a valid token and marks the email verified', async () => {
      const student = await createStudent({ emailVerified: false })
      const rawToken = 'verify-raw-token'
      await db.insert(emailVerificationTokens).values({
        studentId: student.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })

      const res = await api().post(`${BASE}/verify-email`).send({
        token: rawToken,
      })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // The token should be marked used.
      const [tokenRow] = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, hashToken(rawToken)))
      expect(tokenRow.usedAt).not.toBeNull()

      // The student's email should now be verified.
      const [studentRow] = await db
        .select({ emailVerifiedAt: students.emailVerifiedAt })
        .from(students)
        .where(eq(students.id, student.id))
      expect(studentRow.emailVerifiedAt).not.toBeNull()

      // The student can now log in.
      const loginRes = await api().post(`${BASE}/login`).send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })
      expect(loginRes.status).toBe(200)
    })

    it('POST /auth/verify-email rejects an invalid token', async () => {
      const res = await api().post(`${BASE}/verify-email`).send({
        token: 'bogus-verify-token',
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN')
    })

    it('POST /auth/verify-email rejects an expired token', async () => {
      const student = await createStudent({ emailVerified: false })
      const rawToken = 'expired-verify-token'
      await db.insert(emailVerificationTokens).values({
        studentId: student.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
      })

      const res = await api().post(`${BASE}/verify-email`).send({
        token: rawToken,
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN')
    })

    it('POST /auth/verify-email rejects a reused token', async () => {
      const student = await createStudent({ emailVerified: false })
      const rawToken = 'reuse-verify-token'
      await db.insert(emailVerificationTokens).values({
        studentId: student.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })

      const first = await api()
        .post(`${BASE}/verify-email`)
        .send({ token: rawToken })
      expect(first.status).toBe(200)

      const second = await api()
        .post(`${BASE}/verify-email`)
        .send({ token: rawToken })
      expect(second.status).toBe(400)
      expect(second.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN')
    })

    it('POST /auth/resend-verification always returns success (no enumeration)', async () => {
      const student = await createStudent({ emailVerified: false })

      const knownRes = await api()
        .post(`${BASE}/resend-verification`)
        .send({ email: student.email })

      const unknownRes = await api()
        .post(`${BASE}/resend-verification`)
        .send({ email: 'nonexistent@test.edu' })

      expect(knownRes.status).toBe(200)
      expect(knownRes.body.success).toBe(true)
      expect(unknownRes.status).toBe(200)
      expect(unknownRes.body.success).toBe(true)

      // A token row should only exist for the known, unverified student.
      const tokens = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.studentId, student.id))
      expect(tokens).toHaveLength(1)
    })

    it('POST /auth/resend-verification does not send for an already-verified student', async () => {
      const student = await createStudent({ emailVerified: true })

      const res = await api()
        .post(`${BASE}/resend-verification`)
        .send({ email: student.email })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // No token row should be created for a verified student.
      const tokens = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.studentId, student.id))
      expect(tokens).toHaveLength(0)
    })
  })
})

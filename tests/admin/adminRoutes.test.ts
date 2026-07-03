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
import { teachers, students, studentDevices } from '../../src/db/schema.ts'

const BASE = '/v1/admin'

describe('Admin routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // Authorization guard (applies to every admin endpoint)
  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/teachers`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects non-admin roles with 403 ROLE_FORBIDDEN', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/teachers`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })

    it('rejects a teacher with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api().get(`${BASE}/teachers`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // POST /admin/teachers
  // -------------------------------------------------------------------------
  describe('POST /admin/teachers', () => {
    it('creates a teacher and returns 201 (admin session)', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .post(`${BASE}/teachers`)
        .set(cookieHeader(cookie))
        .send({
          name: 'Dr. Ahmed',
          email: 'ahmed@platform.com',
          password: 'tempPassword123',
          bio: 'Mathematics specialist',
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.teacher).toMatchObject({
        name: 'Dr. Ahmed',
        email: 'ahmed@platform.com',
        bio: 'Mathematics specialist',
        isActive: true,
        role: 'teacher',
      })
      expect(res.body.data.teacher.id).toBeTruthy()

      // The acting admin should be recorded on created_by_admin_id.
      const [row] = await db
        .select({ createdByAdminId: teachers.createdByAdminId })
        .from(teachers)
        .where(eq(teachers.id, res.body.data.teacher.id))
      expect(row.createdByAdminId).toBe(admin.id)
    })

    it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
      const admin = await createAdmin()
      const existing = await createTeacher(admin.id, { email: 'dup@platform.com' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .post(`${BASE}/teachers`)
        .set(cookieHeader(cookie))
        .send({
          name: 'Another',
          email: existing.email,
          password: 'tempPassword123',
        })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('EMAIL_TAKEN')
    })

    it('rejects invalid input with 400 VALIDATION_ERROR', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .post(`${BASE}/teachers`)
        .set(cookieHeader(cookie))
        .send({
          name: 'X',
          email: 'not-an-email',
          password: 'short',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  // GET /admin/teachers
  // -------------------------------------------------------------------------
  describe('GET /admin/teachers', () => {
    it('returns a paginated list of teachers with meta', async () => {
      const admin = await createAdmin()
      await createTeacher(admin.id, { name: 'Teacher A' })
      await createTeacher(admin.id, { name: 'Teacher B' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .get(`${BASE}/teachers?page=1&limit=10`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.teachers).toHaveLength(2)
      expect(res.body.data.teachers[0]).toMatchObject({ role: 'teacher' })
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      })
    })

    it('respects pagination limit', async () => {
      const admin = await createAdmin()
      await createTeacher(admin.id, { name: 'Teacher A' })
      await createTeacher(admin.id, { name: 'Teacher B' })
      await createTeacher(admin.id, { name: 'Teacher C' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .get(`${BASE}/teachers?page=1&limit=2`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.teachers).toHaveLength(2)
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      })
    })
  })

  // -------------------------------------------------------------------------
  // GET /admin/students
  // -------------------------------------------------------------------------
  describe('GET /admin/students', () => {
    it('returns a paginated list of students with meta', async () => {
      const admin = await createAdmin()
      await createStudent({ name: 'Student A' })
      await createStudent({ name: 'Student B' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .get(`${BASE}/students?page=1&limit=10`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.students).toHaveLength(2)
      expect(res.body.data.students[0]).toMatchObject({ role: 'student' })
      // emailVerifiedAt should be present (students are verified by default).
      expect(res.body.data.students[0].emailVerifiedAt).not.toBeNull()
      expect(res.body.meta.total).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /admin/teachers/:id
  // -------------------------------------------------------------------------
  describe('PATCH /admin/teachers/:id', () => {
    it('updates only the supplied fields', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id, { name: 'Original' })
      // Set a bio directly; the factory does not expose a bio override.
      await db
        .update(teachers)
        .set({ bio: 'Original bio' })
        .where(eq(teachers.id, teacher.id))
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/teachers/${teacher.id}`)
        .set(cookieHeader(cookie))
        .send({ name: 'Updated Name', isActive: false })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.teacher).toMatchObject({
        id: teacher.id,
        name: 'Updated Name',
        isActive: false,
        role: 'teacher',
      })
      // Omitted field (bio) should be unchanged.
      expect(res.body.data.teacher.bio).toBe('Original bio')
    })

    it('rejects an empty body with 400 VALIDATION_ERROR', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/teachers/${teacher.id}`)
        .set(cookieHeader(cookie))
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id, { email: 'a@platform.com' })
      await createTeacher(admin.id, { email: 'b@platform.com' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/teachers/${teacherA.id}`)
        .set(cookieHeader(cookie))
        .send({ email: 'b@platform.com' })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('EMAIL_TAKEN')
    })

    it('allows renaming to the same email (self-excluding check)', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id, { email: 'keep@platform.com' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/teachers/${teacher.id}`)
        .set(cookieHeader(cookie))
        .send({ email: 'keep@platform.com', name: 'Renamed' })

      expect(res.status).toBe(200)
      expect(res.body.data.teacher.name).toBe('Renamed')
    })

    it('returns 404 TEACHER_NOT_FOUND for a missing id', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/teachers/00000000-0000-0000-0000-000000000000`)
        .set(cookieHeader(cookie))
        .send({ name: 'Nope' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /admin/students/:id
  // -------------------------------------------------------------------------
  describe('PATCH /admin/students/:id', () => {
    it('updates only the supplied fields', async () => {
      const admin = await createAdmin()
      const student = await createStudent({ name: 'Original' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/students/${student.id}`)
        .set(cookieHeader(cookie))
        .send({ name: 'Updated Name', isActive: false })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.student).toMatchObject({
        id: student.id,
        name: 'Updated Name',
        isActive: false,
        role: 'student',
      })
    })

    it('rejects an empty body with 400 VALIDATION_ERROR', async () => {
      const admin = await createAdmin()
      const student = await createStudent()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/students/${student.id}`)
        .set(cookieHeader(cookie))
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
      const admin = await createAdmin()
      const studentA = await createStudent({ email: 'a@student.com' })
      await createStudent({ email: 'b@student.com' })
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/students/${studentA.id}`)
        .set(cookieHeader(cookie))
        .send({ email: 'b@student.com' })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('EMAIL_TAKEN')
    })

    it('returns 404 STUDENT_NOT_FOUND for a missing id', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .patch(`${BASE}/students/00000000-0000-0000-0000-000000000000`)
        .set(cookieHeader(cookie))
        .send({ name: 'Nope' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('STUDENT_NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  // GET /admin/students/:id/devices
  // -------------------------------------------------------------------------
  describe('GET /admin/students/:id/devices', () => {
    it('returns all devices (active and revoked) for a student', async () => {
      const admin = await createAdmin()
      const student = await createStudent()

      // Bind two devices by logging in twice with different fingerprints.
      await api().post('/v1/auth/login').send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
        device_label: 'Chrome / Windows',
      })
      await api().post('/v1/auth/login').send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device2'),
        device_label: 'Safari / Mac',
      })

      // Revoke one device directly in the DB to simulate history.
      const [firstDevice] = await db
        .select()
        .from(studentDevices)
        .where(eq(studentDevices.studentId, student.id))
      await db
        .update(studentDevices)
        .set({ revokedAt: new Date(), revokedReason: 'test revocation' })
        .where(eq(studentDevices.id, firstDevice.id))

      const { cookie } = await loginAs(admin)
      const res = await api()
        .get(`${BASE}/students/${student.id}/devices`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.student_id).toBe(student.id)
      // Both devices are returned, including the revoked one.
      expect(res.body.data.devices).toHaveLength(2)
      const revoked = res.body.data.devices.find(
        (d: { revoked_at: string | null }) => d.revoked_at !== null
      )
      expect(revoked).toBeDefined()
    })

    it('returns 404 STUDENT_NOT_FOUND for a missing student', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .get(`${BASE}/students/00000000-0000-0000-0000-000000000000/devices`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('STUDENT_NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /admin/devices/:id
  // -------------------------------------------------------------------------
  describe('DELETE /admin/devices/:id', () => {
    it('force-revokes an active device and frees the slot', async () => {
      const admin = await createAdmin()
      const student = await createStudent()

      // Bind a device.
      await api().post('/v1/auth/login').send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })
      const [device] = await db
        .select()
        .from(studentDevices)
        .where(eq(studentDevices.studentId, student.id))

      const { cookie } = await loginAs(admin)
      const res = await api()
        .delete(`${BASE}/devices/${device.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.device.revoked_at).not.toBeNull()
      expect(res.body.data.device.revoked_reason).toBe('force-revoked by admin')

      // The DB row should now be revoked.
      const [updated] = await db
        .select()
        .from(studentDevices)
        .where(eq(studentDevices.id, device.id))
      expect(updated.revokedAt).not.toBeNull()
    })

    it('is idempotent when the device is already revoked', async () => {
      const admin = await createAdmin()
      const student = await createStudent()

      await api().post('/v1/auth/login').send({
        email: student.email,
        password: student.password,
        device_fingerprint: fingerprint('device1'),
      })
      const [device] = await db
        .select()
        .from(studentDevices)
        .where(eq(studentDevices.studentId, student.id))

      const { cookie } = await loginAs(admin)
      // First revocation.
      await api().delete(`${BASE}/devices/${device.id}`).set(cookieHeader(cookie))
      // Second revocation — should be idempotent.
      const res = await api()
        .delete(`${BASE}/devices/${device.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.message).toBe('Device was already revoked')
    })

    it('returns 404 DEVICE_NOT_FOUND for a missing device', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api()
        .delete(`${BASE}/devices/00000000-0000-0000-0000-000000000000`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('DEVICE_NOT_FOUND')
    })
  })
})

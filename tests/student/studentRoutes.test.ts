import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import { SESSION_COOKIE_NAME } from '../../src/services/sessionService.ts'
import { createSession } from '../../src/services/sessionService.ts'
import {
  createStudent,
  createTeacher,
  createAdmin,
  createTeacherAccessRequest,
} from '../helpers/factories.ts'

const BASE = '/v1/student'

describe('student routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // Authorization guard (applies to every student endpoint)
  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/devices`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects non-student roles with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api().get(`${BASE}/devices`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // GET /student/devices
  // -------------------------------------------------------------------------
  describe('GET /student/devices', () => {
    it('returns 200 + device list for a student with devices', async () => {
      const student = await createStudent()
      // Logging in binds a device to slot 1 (device_fingerprint required).
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/devices`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data.devices)).toBe(true)
      expect(res.body.data.devices.length).toBeGreaterThanOrEqual(1)
      expect(res.body.data.devices[0]).toMatchObject({
        slot_number: 1,
        device_fingerprint: expect.stringMatching(/^sha256:/),
      })
    })

    it('returns 200 + empty array for a student with no devices', async () => {
      const student = await createStudent()
      // Create a session directly (no login) so no device row is bound.
      const { sessionId } = await createSession({
        id: student.id,
        name: student.name,
        email: student.email,
        role: 'student',
      })
      const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`

      const res = await api().get(`${BASE}/devices`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.devices).toEqual([])
    })

    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/devices`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects teacher role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api().get(`${BASE}/devices`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })

    it('rejects admin role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api().get(`${BASE}/devices`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // POST /student/access-requests/:teacherId
  // -------------------------------------------------------------------------
  describe('POST /student/access-requests/:teacherId', () => {
    it('creates a pending request and returns 201', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/${teacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.accessRequest).toMatchObject({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'pending',
      })
    })

    it('returns 404 TEACHER_NOT_FOUND for an unknown teacher id', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/00000000-0000-4000-8000-000000000000`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND')
    })

    it('returns 404 TEACHER_NOT_FOUND for an inactive teacher', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id, { isActive: false })
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/${teacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND')
    })

    it('returns 409 ACCESS_REQUEST_EXISTS when a pending request already exists', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'pending',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/${teacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('ACCESS_REQUEST_EXISTS')
    })

    it('returns 409 ACCESS_REQUEST_EXISTS when an approved request already exists', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/${teacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('ACCESS_REQUEST_EXISTS')
    })

    it('returns 409 ACCESS_REQUEST_EXISTS when a rejected request already exists', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'rejected',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/${teacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('ACCESS_REQUEST_EXISTS')
    })

    it('returns 400 VALIDATION_ERROR for a non-uuid param', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/access-requests/not-a-uuid`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)

      const res = await api().post(`${BASE}/access-requests/${teacher.id}`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects teacher role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const otherTeacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${BASE}/access-requests/${otherTeacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })

    it('rejects admin role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(admin)

      const res = await api()
        .post(`${BASE}/access-requests/${teacher.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // GET /student/my-teachers
  // -------------------------------------------------------------------------
  describe('GET /student/my-teachers', () => {
    it('returns only approved teachers (pending/rejected excluded)', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id, { name: 'Teacher A' })
      const teacherB = await createTeacher(admin.id, { name: 'Teacher B' })
      const teacherC = await createTeacher(admin.id, { name: 'Teacher C' })
      const student = await createStudent()

      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacherA.id,
        status: 'approved',
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacherB.id,
        status: 'pending',
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacherC.id,
        status: 'rejected',
      })

      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/my-teachers?page=1&limit=10`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.teachers).toHaveLength(1)
      expect(res.body.data.teachers[0]).toMatchObject({
        name: 'Teacher A',
        role: 'teacher',
        access_request_status: 'approved',
      })
    })

    it('returns pagination meta', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/my-teachers?page=1&limit=10`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      })
    })

    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/my-teachers`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects teacher role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api().get(`${BASE}/my-teachers`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })

    it('rejects admin role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const { cookie } = await loginAs(admin)

      const res = await api().get(`${BASE}/my-teachers`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })
})

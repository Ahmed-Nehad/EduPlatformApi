import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createStudent,
  createLecture,
  createTeacherAccessRequest,
  createWalletTransaction,
  createLecturePurchase,
} from '../helpers/factories.ts'

const BASE = '/v1/student'

describe('student purchase routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/transactions`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects teacher role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api().get(`${BASE}/transactions`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // POST /student/lectures/:id/purchase
  // -------------------------------------------------------------------------
  describe('POST /student/lectures/:id/purchase', () => {
    it('purchases a published lecture with sufficient balance', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        title: 'Buy Me',
        status: 'published',
        price: 50,
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.purchase.lectureId).toBe(lecture.id)
      expect(res.body.data.balance_after).toBe('50.00')
    })

    it('returns 404 LECTURE_NOT_FOUND for unknown lecture', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/00000000-0000-0000-0000-000000000000/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 403 LECTURE_NOT_PUBLISHED for draft lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, { status: 'draft' })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('LECTURE_NOT_PUBLISHED')
    })

    it('returns 404 LECTURE_NOT_FOUND for soft-deleted lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        deletedAt: new Date(),
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 403 LECTURE_EXPIRED for expired lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        expiresAt: new Date(Date.now() - 86400000),
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('LECTURE_EXPIRED')
    })

    it('returns 403 TEACHER_ACCESS_REQUIRED for student without approved access', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        price: 10,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('TEACHER_ACCESS_REQUIRED')
    })

    it('returns 403 TEACHER_ACCESS_REQUIRED for student with pending access only', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        price: 10,
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'pending',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('TEACHER_ACCESS_REQUIRED')
    })

    it('returns 409 LECTURE_ALREADY_PURCHASED for double purchase', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        price: 25,
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const walletTx = await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      await createLecturePurchase({
        studentId: student.id,
        lectureId: lecture.id,
        walletTransactionId: walletTx.id,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('LECTURE_ALREADY_PURCHASED')
    })

    it('returns 402 INSUFFICIENT_BALANCE when per-teacher balance < price', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        price: 200,
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 50,
        balanceAfter: 50,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(402)
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE')
    })

    it('returns 402 INSUFFICIENT_BALANCE — per-teacher isolation', async () => {
      const admin = await createAdmin()
      const teacherX = await createTeacher(admin.id)
      const teacherZ = await createTeacher(admin.id)
      const student = await createStudent()

      // Lecture from teacher Z
      const lectureZ = await createLecture(teacherZ.id, {
        status: 'published',
        price: 100,
      })
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacherZ.id,
        status: 'approved',
      })

      // Large balance with teacher X, none with teacher Z
      await createWalletTransaction(student.id, teacherX.id, {
        type: 'credit_code',
        amount: 1000,
        balanceAfter: 1000,
      })

      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/lectures/${lectureZ.id}/buy`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(402)
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE')
    })
  })

  // -------------------------------------------------------------------------
  // GET /student/transactions
  // -------------------------------------------------------------------------
  describe('GET /student/transactions', () => {
    it('returns purchased lectures with teacher name', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, {
        title: 'Bought Lecture',
        status: 'published',
        price: 10,
      })
      const walletTx = await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      await createLecturePurchase({
        studentId: student.id,
        lectureId: lecture.id,
        walletTransactionId: walletTx.id,
      })
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/transactions`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.purchases).toHaveLength(1)
      expect(res.body.data.purchases[0]).toMatchObject({
        lectureId: lecture.id,
        lectureTitle: 'Bought Lecture',
        teacherName: teacher.name,
      })
    })

    it('returns pagination meta', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const lecture = await createLecture(teacher.id, { status: 'published', price: 5 })
      const walletTx = await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      await createLecturePurchase({
        studentId: student.id,
        lectureId: lecture.id,
        walletTransactionId: walletTx.id,
      })
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/transactions`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.meta).toMatchObject({ total: 1, page: 1 })
    })

    it('returns empty array for student with no purchases', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/transactions`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.purchases).toEqual([])
    })
  })
})

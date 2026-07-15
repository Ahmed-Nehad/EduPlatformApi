import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createStudent,
  createRedemptionCode,
} from '../helpers/factories.ts'

const BASE = '/v1/codes'

describe('teacher code routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(BASE)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects student role with 403 ROLE_FORBIDDEN', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api().get(BASE).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // POST /codes
  // -------------------------------------------------------------------------
  describe('POST /codes', () => {
    it('creates a code with credit_amount', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({ code: 'MYCODE123', credit_amount: 250 })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.code).toMatchObject({
        code: 'MYCODE123',
        creditAmount: '250.00',
        isActive: true,
      })
    })

    it('creates a code with expires_at', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const expiresAt = new Date(Date.now() + 86400000).toISOString()

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({ code: 'EXP_CODE', credit_amount: 50, expires_at: expiresAt })

      expect(res.status).toBe(201)
      expect(res.body.data.code.expiresAt).toBeDefined()
    })

    it('returns 409 CODE_ALREADY_EXISTS for duplicate code string', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({ code: 'DUP_CODE', credit_amount: 100 })

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({ code: 'DUP_CODE', credit_amount: 200 })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CODE_ALREADY_EXISTS')
    })
  })

  // -------------------------------------------------------------------------
  // GET /codes
  // -------------------------------------------------------------------------
  describe('GET /codes', () => {
    it('returns my codes with pagination meta', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      await createRedemptionCode(teacher.id, { code: 'T1CODE' })

      const res = await api().get(BASE).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.codes).toHaveLength(1)
      expect(res.body.data.codes[0].code).toBe('T1CODE')
      expect(res.body.meta).toMatchObject({ total: 1, page: 1 })
    })

    it('includes soft-deleted codes', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      await createRedemptionCode(teacher.id, {
        code: 'DEL_CODE',
        deletedAt: new Date(),
      })

      const res = await api().get(BASE).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.codes).toHaveLength(1)
      expect(res.body.data.codes[0].deletedAt).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /codes/:id
  // -------------------------------------------------------------------------
  describe('DELETE /codes/:id', () => {
    it('soft deletes a code (deletedAt set)', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const code = await createRedemptionCode(teacher.id, { code: 'TO_DEL' })

      const res = await api()
        .delete(`${BASE}/${code.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.code.id).toBe(code.id)
      expect(res.body.data.code.deletedAt).toBeDefined()
    })

    it('returns 404 CODE_NOT_FOUND for another teacher\'s code', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherA)
      const code = await createRedemptionCode(teacherB.id)

      const res = await api()
        .delete(`${BASE}/${code.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('CODE_NOT_FOUND')
    })

    it('is idempotent — re-deleting returns same result', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const code = await createRedemptionCode(teacher.id)

      await api().delete(`${BASE}/${code.id}`).set(cookieHeader(cookie))
      const res = await api()
        .delete(`${BASE}/${code.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.code.id).toBe(code.id)
    })
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createStudent,
  createRedemptionCode,
  createWalletTransaction,
  createCodeRedemption,
} from '../helpers/factories.ts'

const BASE = '/v1/wallet'

describe('student wallet routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/balance`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects teacher role with 403 ROLE_FORBIDDEN', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api().get(`${BASE}/balance`).set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // POST /wallet/redeem
  // -------------------------------------------------------------------------
  describe('POST /wallet/redeem', () => {
    it('redeems a valid code and returns balance_after', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const code = await createRedemptionCode(teacher.id, {
        code: 'GOODCODE',
        creditAmount: 150,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'GOODCODE' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.balance_after).toBe('150.00')
      expect(res.body.data.credit_amount).toBe('150.00')
      expect(res.body.data.teacher_id).toBe(teacher.id)
    })

    it('returns 404 CODE_NOT_FOUND for unknown code', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'NONEXISTENT' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('CODE_NOT_FOUND')
    })

    it('returns 410 CODE_INACTIVE for inactive code', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createRedemptionCode(teacher.id, {
        code: 'INACTIVE',
        isActive: false,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'INACTIVE' })

      expect(res.status).toBe(410)
      expect(res.body.error.code).toBe('CODE_INACTIVE')
    })

    it('returns 410 CODE_DELETED for soft-deleted code', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createRedemptionCode(teacher.id, {
        code: 'DELETED',
        deletedAt: new Date(),
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'DELETED' })

      expect(res.status).toBe(410)
      expect(res.body.error.code).toBe('CODE_DELETED')
    })

    it('returns 410 CODE_EXPIRED for expired code', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createRedemptionCode(teacher.id, {
        code: 'EXPIRED',
        expiresAt: new Date(Date.now() - 86400000),
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'EXPIRED' })

      expect(res.status).toBe(410)
      expect(res.body.error.code).toBe('CODE_EXPIRED')
    })

    it('returns 409 CODE_ALREADY_REDEEMED for already-redeemed code', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      const code = await createRedemptionCode(teacher.id, { code: 'USED' })
      const walletTx = await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      await createCodeRedemption({
        codeId: code.id,
        studentId: student.id,
        walletTransactionId: walletTx.id,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'USED' })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CODE_ALREADY_REDEEMED')
    })

    it('creates separate per-teacher balances for codes from different teachers', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const student = await createStudent()
      await createRedemptionCode(teacherA.id, { code: 'CODE_A', creditAmount: 100 })
      await createRedemptionCode(teacherB.id, { code: 'CODE_B', creditAmount: 200 })
      const { cookie } = await loginAs(student)

      // Redeem teacher A's code
      await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'CODE_A' })

      // Redeem teacher B's code
      await api()
        .post(`${BASE}/redeem`)
        .set(cookieHeader(cookie))
        .send({ code: 'CODE_B' })

      // Check balance — should have separate entries
      const res = await api().get(`${BASE}/balance`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.balances).toHaveLength(2)
      const balA = res.body.data.balances.find(
        (b: { teacherId: string }) => b.teacherId === teacherA.id
      )
      const balB = res.body.data.balances.find(
        (b: { teacherId: string }) => b.teacherId === teacherB.id
      )
      expect(balA.balance).toBe('100.00')
      expect(balB.balance).toBe('200.00')
    })
  })

  // -------------------------------------------------------------------------
  // GET /wallet/balance
  // -------------------------------------------------------------------------
  describe('GET /wallet/balance', () => {
    it('returns per-teacher balances', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/balance`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.balances).toHaveLength(1)
      expect(res.body.data.balances[0]).toMatchObject({
        teacherId: teacher.id,
        teacherName: teacher.name,
        balance: '100.00',
      })
    })

    it('returns empty array for student with no transactions', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/balance`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.balances).toEqual([])
    })

    it('reflects separate balances per teacher', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const student = await createStudent()
      await createWalletTransaction(student.id, teacherA.id, {
        type: 'credit_code',
        amount: 50,
        balanceAfter: 50,
      })
      await createWalletTransaction(student.id, teacherB.id, {
        type: 'credit_code',
        amount: 75,
        balanceAfter: 75,
      })
      const { cookie } = await loginAs(student)

      const res = await api().get(`${BASE}/balance`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.balances).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // GET /wallet/transactions
  // -------------------------------------------------------------------------
  describe('GET /wallet/transactions', () => {
    it('returns ledger history newest first with teacherId + teacherName', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createWalletTransaction(student.id, teacher.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
        description: 'Redeemed code: TEST',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/transactions`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.transactions).toHaveLength(1)
      expect(res.body.data.transactions[0]).toMatchObject({
        type: 'credit_code',
        amount: '100.00',
        balanceAfter: '100.00',
        teacherId: teacher.id,
        teacherName: teacher.name,
      })
      expect(res.body.meta).toMatchObject({ total: 1, page: 1 })
    })

    it('returns empty array for student with no transactions', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/transactions`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.transactions).toEqual([])
    })
  })
})

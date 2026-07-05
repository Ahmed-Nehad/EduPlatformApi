import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
    createStudent,
    createTeacher,
    createAdmin,
    createTeacherAccessRequest,
} from '../helpers/factories.ts'

const BASE = '/v1/teacher'

describe('teacher routes', () => {
    afterEach(async () => {
        await resetAuthState()
    })

    // -------------------------------------------------------------------------
    // Authorization guard (applies to every admin endpoint)
    // -------------------------------------------------------------------------
    describe('Authorization', () => {
        it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
            const res = await api().get(`${BASE}/students`)

            expect(res.status).toBe(401)
            expect(res.body.error.code).toBe('NO_SESSION')
        })

        it('rejects non-teacher roles with 403 ROLE_FORBIDDEN', async () => {
            const student = await createStudent()
            const { cookie } = await loginAs(student)

            const res = await api().get(`${BASE}/students`).set(cookieHeader(cookie))

            expect(res.status).toBe(403)
            expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
        })
    })

    // -------------------------------------------------------------------------
    // GET /teacher/students
    // -------------------------------------------------------------------------
    describe('GET /teacher/students', () => {
        it('returns a paginated list of approved students with meta', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const studentA = await createStudent({ name: 'Student A' })
            await createTeacherAccessRequest({ studentId: studentA.id, teacherId: teacher.id, status: 'approved' })
            const studentB = await createStudent({ name: 'Student B' })
            await createTeacherAccessRequest({ studentId: studentB.id, teacherId: teacher.id, status: 'approved' })
            const studentC = await createStudent({ name: 'Student C' })
            await createTeacherAccessRequest({ studentId: studentC.id, teacherId: teacher.id, status: 'pending' })
            await createStudent({ name: 'Student D' })

            const res = await api()
                .get(`${BASE}/students?page=1&limit=10`)
                .set(cookieHeader(cookie))

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.students).toHaveLength(2)
            expect(res.body.data.students[0]).toMatchObject({ role: 'student' })
            expect(res.body.data.students[1]).toMatchObject({ name: 'Student A' })
            expect(res.body.meta).toMatchObject({
                page: 1,
                limit: 10,
                total: 2,
                totalPages: 1,
            })
        })

        it('returns a list of approved students with meta', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const studentA = await createStudent({ name: 'Student A' })
            await createTeacherAccessRequest({ studentId: studentA.id, teacherId: teacher.id, status: 'approved' })
            const studentB = await createStudent({ name: 'Student B' })
            await createTeacherAccessRequest({ studentId: studentB.id, teacherId: teacher.id, status: 'approved' })
            const studentC = await createStudent({ name: 'Student C' })
            await createTeacherAccessRequest({ studentId: studentC.id, teacherId: teacher.id, status: 'pending' })
            await createStudent({ name: 'Student D' })

            const res = await api()
                .get(`${BASE}/students?status=approved`)
                .set(cookieHeader(cookie))

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.students).toHaveLength(2)
            expect(res.body.data.students[0]).toMatchObject({ role: 'student' })
            expect(res.body.data.students[1]).toMatchObject({ name: 'Student A' })
            expect(res.body.meta.total).toBe(2)
        })

        it('returns a list of pending students with meta', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const studentA = await createStudent({ name: 'Student A' })
            await createTeacherAccessRequest({ studentId: studentA.id, teacherId: teacher.id, status: 'approved' })
            const studentB = await createStudent({ name: 'Student B' })
            await createTeacherAccessRequest({ studentId: studentB.id, teacherId: teacher.id, status: 'approved' })
            const studentC = await createStudent({ name: 'Student C' })
            await createTeacherAccessRequest({ studentId: studentC.id, teacherId: teacher.id, status: 'pending' })
            await createStudent({ name: 'Student D' })

            const res = await api()
                .get(`${BASE}/students?status=pending`)
                .set(cookieHeader(cookie))

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.students).toHaveLength(1)
            expect(res.body.data.students[0]).toMatchObject({ role: 'student' })
            expect(res.body.data.students[0]).toMatchObject({ name: 'Student C' })
            expect(res.body.meta.total).toBe(1)
        })

        it('returns empty list of approved students.', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const studentC = await createStudent({ name: 'Student C' })
            await createTeacherAccessRequest({ studentId: studentC.id, teacherId: teacher.id, status: 'pending' })
            await createStudent({ name: 'Student D' })

            const res = await api()
                .get(`${BASE}/students`)
                .set(cookieHeader(cookie))

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.students).toHaveLength(0)
        })
    })

    describe('PATCH /teacher/access-requests/:studentId', () => {
        it('updates only the supplied fields', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const student = await createStudent({ name: 'Student' })
            await createTeacherAccessRequest({ studentId: student.id, teacherId: teacher.id, status: 'pending' })

            const res = await api()
                .patch(`${BASE}/access-requests/${student.id}`)
                .set(cookieHeader(cookie))
                .send({ status: 'approved' })

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.accessRequest).toMatchObject({
                status: 'approved'
            })
        })

        it('rejects an empty body with 400 VALIDATION_ERROR', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const student = await createStudent({ name: 'Student' })
            await createTeacherAccessRequest({ studentId: student.id, teacherId: teacher.id, status: 'pending' })

            const res = await api()
                .patch(`${BASE}/access-requests/${student.id}`)
                .set(cookieHeader(cookie))
                .send({})

            expect(res.status).toBe(400)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('rejects a body with invalid data types with 400 VALIDATION_ERROR', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const student = await createStudent({ name: 'Student' })
            await createTeacherAccessRequest({ studentId: student.id, teacherId: teacher.id, status: 'rejected' })

            const res = await api()
                .patch(`${BASE}/access-requests/${student.id}`)
                .set(cookieHeader(cookie))
                .send({ status: 'waiting' })

            expect(res.status).toBe(400)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 404 STUDENT_NOT_FOUND for a missing id', async () => {
            const admin = await createAdmin()
            const teacher = await createTeacher(admin.id)
            const { cookie } = await loginAs(teacher)

            const res = await api()
                .patch(`${BASE}/access-requests/00000000-0000-0000-0000-000000000000`)
                .set(cookieHeader(cookie))
                .send({ status: 'approved' })

            expect(res.status).toBe(404)
            expect(res.body.error.code).toBe('ACCESS_REQUEST_NOT_FOUND')
        })
    })
})

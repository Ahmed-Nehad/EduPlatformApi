import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createLecture,
} from '../helpers/factories.ts'

const BASE = '/v1'

describe('public teacher catalog routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // GET /lectures/teachers
  // -------------------------------------------------------------------------
  describe('GET /teachers', () => {
    it('lists active teachers with pagination meta (no auth required)', async () => {
      const admin = await createAdmin()
      await createTeacher(admin.id, { name: 'Teacher A' })
      await createTeacher(admin.id, { name: 'Teacher B' })

      const res = await api().get(`${BASE}/teachers`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.teachers).toHaveLength(2)
      expect(res.body.meta).toMatchObject({ page: 1 })
    })

    it('excludes inactive teachers', async () => {
      const admin = await createAdmin()
      await createTeacher(admin.id, { name: 'Active', isActive: true })
      await createTeacher(admin.id, { name: 'Inactive', isActive: false })

      const res = await api().get(`${BASE}/teachers`)

      expect(res.status).toBe(200)
      expect(res.body.data.teachers).toHaveLength(1)
      expect(res.body.data.teachers[0].name).toBe('Active')
    })
  })

  // -------------------------------------------------------------------------
  // GET /lectures/teachers/:id/lectures
  // -------------------------------------------------------------------------
  describe('GET /teachers/:id/lectures', () => {
    it('lists published lectures for a teacher', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      await createLecture(teacher.id, {
        title: 'Pub 1',
        status: 'published',
      })
      await createLecture(teacher.id, {
        title: 'Pub 2',
        status: 'published',
      })

      const res = await api().get(`${BASE}/teachers/${teacher.id}/lectures`)

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(2)
      expect(res.body.meta).toMatchObject({ page: 1 })
    })

    it('excludes draft and soft-deleted lectures', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      await createLecture(teacher.id, { status: 'published' })
      await createLecture(teacher.id, { status: 'draft' })
      await createLecture(teacher.id, {
        status: 'published',
        deletedAt: new Date(),
      })

      const res = await api().get(`${BASE}/teachers/${teacher.id}/lectures`)

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(1)
    })

    it('returns 404 TEACHER_NOT_FOUND for unknown or inactive teacher', async () => {
      const res = await api().get(
        `${BASE}/teachers/00000000-0000-0000-0000-000000000000/lectures`
      )

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND')
    })
  })
})

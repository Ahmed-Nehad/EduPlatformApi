import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createStudent,
  createLecture,
  createVideo,
  createFile,
  createQuiz,
  createContentItem,
} from '../helpers/factories.ts'

const BASE = '/v1/teacher'

describe('teacher lecture routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // Authorization guard (applies to every teacher endpoint)
  // -------------------------------------------------------------------------
  describe('Authorization', () => {
    it('rejects unauthenticated requests with 401 NO_SESSION', async () => {
      const res = await api().get(`${BASE}/lectures`)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('rejects non-teacher roles with 403 ROLE_FORBIDDEN', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)
      const res = await api().get(`${BASE}/lectures`).set(cookieHeader(cookie))
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  // POST /teacher/lectures
  // -------------------------------------------------------------------------
  describe('POST /teacher/lectures', () => {
    it('creates a lecture with status=draft and returns 201', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${BASE}/lectures`)
        .set(cookieHeader(cookie))
        .send({ title: 'Calculus 101', description: 'Intro to calc', price: 50 })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.lecture).toMatchObject({
        title: 'Calculus 101',
        description: 'Intro to calc',
        status: 'draft',
        teacherId: teacher.id,
      })
      expect(res.body.data.lecture.price).toBe('50.00')
    })

    it('rejects invalid input with 400 VALIDATION_ERROR', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${BASE}/lectures`)
        .set(cookieHeader(cookie))
        .send({ price: 50 }) // missing title

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  // GET /teacher/lectures/:id
  // -------------------------------------------------------------------------
  describe('GET /teacher/lectures/:id', () => {
    it('returns draft lecture with content items including IDs', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id, {
        title: 'Draft Calc',
        description: 'Work in progress',
        status: 'draft',
      })
      const video = await createVideo(lecture.id, {
        title: 'Limits Intro',
        description: 'Intro to limits',
        durationSeconds: 600,
      })
      const quiz = await createQuiz(lecture.id, { title: 'Quiz 1' })
      const item1 = await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })
      const item2 = await createContentItem({
        lectureId: lecture.id,
        contentType: 'quiz',
        contentId: quiz.id,
        position: 2,
      })

      const res = await api()
        .get(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.lecture).toMatchObject({
        title: 'Draft Calc',
        description: 'Work in progress',
        status: 'draft',
      })
      expect(res.body.data.content_items).toHaveLength(2)
      expect(res.body.data.content_items[0]).toMatchObject({
        id: item1.id,
        content_type: 'video',
        content_id: video.id,
        content_name: 'Limits Intro',
        position: 1,
        duration_seconds: 600,
      })
      expect(res.body.data.content_items[1]).toMatchObject({
        id: item2.id,
        content_type: 'quiz',
        content_id: quiz.id,
        content_name: 'Quiz 1',
        position: 2,
        duration_seconds: null,
      })
    })

    it('returns published lecture with ordered content items', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id, {
        title: 'Published Calc',
        status: 'published',
      })
      const video = await createVideo(lecture.id, { title: 'Video 1' })
      const file = await createFile(lecture.id, { title: 'File 1' })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'file',
        contentId: file.id,
        position: 2,
      })

      const res = await api()
        .get(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.lecture.status).toBe('published')
      expect(res.body.data.content_items).toHaveLength(2)
      expect(res.body.data.content_items[0].content_type).toBe('video')
      expect(res.body.data.content_items[1].content_type).toBe('file')
    })

    it('returns 404 LECTURE_NOT_FOUND for another teacher lecture', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)

      const res = await api()
        .get(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 404 LECTURE_NOT_FOUND for a soft-deleted lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id, { deletedAt: new Date() })

      const res = await api()
        .get(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR for a non-uuid id', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .get(`${BASE}/lectures/not-a-uuid`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /teacher/lectures/:id
  // -------------------------------------------------------------------------
  describe('PATCH /teacher/lectures/:id', () => {
    it('updates only the supplied fields', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id, { title: 'Old' })

      const res = await api()
        .patch(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))
        .send({ title: 'New', status: 'published' })

      expect(res.status).toBe(200)
      expect(res.body.data.lecture).toMatchObject({
        title: 'New',
        status: 'published',
      })
    })

    it('returns 404 LECTURE_NOT_FOUND for another teacher lecture', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)

      const res = await api()
        .patch(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))
        .send({ title: 'Hijack' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('rejects an empty body with 400 VALIDATION_ERROR', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)

      const res = await api()
        .patch(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /teacher/lectures/:id
  // -------------------------------------------------------------------------
  describe('DELETE /teacher/lectures/:id', () => {
    it('soft-deletes a lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)

      const res = await api()
        .delete(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.lecture.id).toBe(lecture.id)
      expect(res.body.data.lecture.deletedAt).not.toBeNull()
    })

    it('returns 404 for another teacher lecture', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)

      const res = await api()
        .delete(`${BASE}/lectures/${lecture.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  // GET /teacher/lectures
  // -------------------------------------------------------------------------
  describe('GET /teacher/lectures', () => {
    it('returns only my lectures with pagination meta', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const other = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      await createLecture(teacher.id, { title: 'Mine 1' })
      await createLecture(teacher.id, { title: 'Mine 2', status: 'published' })
      await createLecture(other.id, { title: 'Theirs' })

      const res = await api()
        .get(`${BASE}/lectures?page=1&limit=10`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(2)
      expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 2 })
    })

    it('filters by status', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      await createLecture(teacher.id, { status: 'draft' })
      await createLecture(teacher.id, { status: 'published' })

      const res = await api()
        .get(`${BASE}/lectures?status=published`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(1)
      expect(res.body.data.lectures[0].status).toBe('published')
    })

    it('excludes soft-deleted lectures', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      await createLecture(teacher.id, { deletedAt: new Date() })
      await createLecture(teacher.id)

      const res = await api().get(`${BASE}/lectures`).set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(1)
    })
  })
})

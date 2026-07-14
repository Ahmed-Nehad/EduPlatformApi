import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createLecture,
  createVideo,
  createFile,
  createQuiz,
  createContentItem,
} from '../helpers/factories.ts'

const BASE = '/v1/lectures'

describe('public lecture catalog routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // GET /lectures
  // -------------------------------------------------------------------------
  describe('GET /lectures', () => {
    it('returns published lectures with pagination meta (no auth required)', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      await createLecture(teacher.id, { title: 'Pub 1', status: 'published' })
      await createLecture(teacher.id, { title: 'Pub 2', status: 'published' })
      await createLecture(teacher.id, { title: 'Draft', status: 'draft' })

      const res = await api().get(`${BASE}?page=1&limit=10`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.lectures).toHaveLength(2)
      expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 2 })
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

      const res = await api().get(`${BASE}`)

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(1)
    })

    it('filters by teacher_id', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      await createLecture(teacherA.id, { status: 'published' })
      await createLecture(teacherB.id, { status: 'published' })

      const res = await api().get(`${BASE}?teacher_id=${teacherA.id}`)

      expect(res.status).toBe(200)
      expect(res.body.data.lectures).toHaveLength(1)
      expect(res.body.data.lectures[0].teacherId).toBe(teacherA.id)
    })

    it('returns teacher name in the catalog', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id, { name: 'Dr. Smith' })
      await createLecture(teacher.id, { status: 'published' })

      const res = await api().get(`${BASE}`)

      expect(res.status).toBe(200)
      expect(res.body.data.lectures[0].teacherName).toBe('Dr. Smith')
    })
  })

  // -------------------------------------------------------------------------
  // GET /lectures/:id
  // -------------------------------------------------------------------------
  describe('GET /lectures/:id', () => {
    it('returns lecture detail + ordered content items (no auth required)', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        title: 'Calculus',
        description: 'Limits and continuity',
      })
      const video = await createVideo(lecture.id, {
        title: 'Lecture 1 - Limits',
        description: 'Introduction to limits',
        durationSeconds: 900,
      })
      const quiz = await createQuiz(lecture.id, {
        title: 'Week 1 Quiz',
        description: null,
      })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'quiz',
        contentId: quiz.id,
        position: 2,
      })

      const res = await api().get(`${BASE}/${lecture.id}`)

      expect(res.status).toBe(200)
      expect(res.body.data.lecture).toMatchObject({
        title: 'Calculus',
        description: 'Limits and continuity',
        teacherName: 'Test Teacher',
      })
      expect(res.body.data.content_items).toHaveLength(2)
      expect(res.body.data.content_items[0]).toMatchObject({
        content_type: 'video',
        content_name: 'Lecture 1 - Limits',
        description: 'Introduction to limits',
        position: 1,
        duration_seconds: 900,
      })
      expect(res.body.data.content_items[1]).toMatchObject({
        content_type: 'quiz',
        content_name: 'Week 1 Quiz',
        position: 2,
        duration_seconds: null,
      })
    })

    it('returns 404 LECTURE_NOT_FOUND for a draft lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const lecture = await createLecture(teacher.id, { status: 'draft' })

      const res = await api().get(`${BASE}/${lecture.id}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 404 LECTURE_NOT_FOUND for a soft-deleted lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const lecture = await createLecture(teacher.id, {
        status: 'published',
        deletedAt: new Date(),
      })

      const res = await api().get(`${BASE}/${lecture.id}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 404 LECTURE_NOT_FOUND for an unknown id', async () => {
      const res = await api().get(
        `${BASE}/00000000-0000-0000-0000-000000000000`
      )
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR for a non-uuid id', async () => {
      const res = await api().get(`${BASE}/not-a-uuid`)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('excludes soft-deleted content from the content list', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const lecture = await createLecture(teacher.id, { status: 'published' })
      const video = await createVideo(lecture.id, { title: 'Live Video' })
      const deletedVideo = await createVideo(lecture.id, {
        title: 'Deleted Video',
        deletedAt: new Date(),
      })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: deletedVideo.id,
        position: 2,
      })

      const res = await api().get(`${BASE}/${lecture.id}`)

      expect(res.status).toBe(200)
      // The deleted video's LEFT JOIN yields NULLs → content_name is NULL.
      expect(res.body.data.content_items).toHaveLength(2)
      expect(res.body.data.content_items[0].content_name).toBe('Live Video')
      expect(res.body.data.content_items[1].content_name).toBeNull()
    })
  })
})

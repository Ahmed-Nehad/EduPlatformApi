import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createLecture,
  createVideo,
  createFile,
  createQuiz,
  createContentItem,
} from '../helpers/factories.ts'

const BASE = '/v1/teacher'

describe('teacher content ordering routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // -------------------------------------------------------------------------
  // POST /teacher/lectures/:id/content
  // -------------------------------------------------------------------------
  describe('POST /teacher/lectures/:id/content', () => {
    it('adds a content item and returns 201', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const video = await createVideo(lecture.id)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/content`)
        .set(cookieHeader(cookie))
        .send({ content_type: 'video', content_id: video.id, position: 1 })

      expect(res.status).toBe(201)
      expect(res.body.data.contentItem).toMatchObject({
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })
    })

    it('returns 404 CONTENT_NOT_FOUND when content belongs to another lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lectureA = await createLecture(teacher.id)
      const lectureB = await createLecture(teacher.id)
      const video = await createVideo(lectureB.id)

      const res = await api()
        .post(`${BASE}/lectures/${lectureA.id}/content`)
        .set(cookieHeader(cookie))
        .send({ content_type: 'video', content_id: video.id, position: 1 })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('CONTENT_NOT_FOUND')
    })

    it('returns 409 POSITION_TAKEN on duplicate position', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const video1 = await createVideo(lecture.id, { vdocipherVideoId: 'vdo1' })
      const video2 = await createVideo(lecture.id, { vdocipherVideoId: 'vdo2' })
      await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video1.id,
        position: 1,
      })

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/content`)
        .set(cookieHeader(cookie))
        .send({ content_type: 'video', content_id: video2.id, position: 1 })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('POSITION_TAKEN')
    })

    it('returns 404 LECTURE_NOT_FOUND for another teacher lecture', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)
      const video = await createVideo(lecture.id)

      const res = await api()
        .post(`${BASE}/lectures/${lecture.id}/content`)
        .set(cookieHeader(cookie))
        .send({ content_type: 'video', content_id: video.id, position: 1 })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /teacher/lectures/:id/content (bulk reorder)
  // -------------------------------------------------------------------------
  describe('PATCH /teacher/lectures/:id/content', () => {
    it('reorders content items', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const video = await createVideo(lecture.id, { vdocipherVideoId: 'v1' })
      const file = await createFile(lecture.id)
      const item1 = await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })
      const item2 = await createContentItem({
        lectureId: lecture.id,
        contentType: 'file',
        contentId: file.id,
        position: 2,
      })

      const res = await api()
        .patch(`${BASE}/lectures/${lecture.id}/content`)
        .set(cookieHeader(cookie))
        .send({
          items: [
            { item_id: item2.id, position: 1 },
            { item_id: item1.id, position: 2 },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.contentItems[0].id).toBe(item2.id)
      expect(res.body.data.contentItems[0].position).toBe(1)
      expect(res.body.data.contentItems[1].id).toBe(item1.id)
      expect(res.body.data.contentItems[1].position).toBe(2)
    })

    it('returns 404 CONTENT_ITEM_NOT_FOUND for foreign item', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const video = await createVideo(lecture.id)
      const item = await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })

      const res = await api()
        .patch(`${BASE}/lectures/${lecture.id}/content`)
        .set(cookieHeader(cookie))
        .send({
          items: [
            { item_id: '00000000-0000-0000-0000-000000000000', position: 1 },
            { item_id: item.id, position: 2 },
          ],
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('CONTENT_ITEM_NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /teacher/lectures/:id/content/:itemId
  // -------------------------------------------------------------------------
  describe('DELETE /teacher/lectures/:id/content/:itemId', () => {
    it('removes a content item', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const video = await createVideo(lecture.id)
      const item = await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })

      const res = await api()
        .delete(`${BASE}/lectures/${lecture.id}/content/${item.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.contentItem.id).toBe(item.id)
    })

    it('returns 404 for another teacher content item', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)
      const video = await createVideo(lecture.id)
      const item = await createContentItem({
        lectureId: lecture.id,
        contentType: 'video',
        contentId: video.id,
        position: 1,
      })

      const res = await api()
        .delete(`${BASE}/lectures/${lecture.id}/content/${item.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('CONTENT_ITEM_NOT_FOUND')
    })
  })
})

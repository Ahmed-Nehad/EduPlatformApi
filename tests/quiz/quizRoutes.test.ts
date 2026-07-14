import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createLecture,
  createQuiz,
  createQuestion,
  createTrueFalseQuestion,
  createWrittenQuestion,
} from '../helpers/factories.ts'
import { createStudent } from '../helpers/factories.ts'

const BASE = '/v1/quizzes'

describe('quiz CRUD & question management routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // =========================================================================
  // Authorization (shared)
  // =========================================================================
  describe('authorization', () => {
    it('returns 401 NO_SESSION without cookie', async () => {
      const res = await api().get(`${BASE}/00000000-0000-0000-0000-000000000000`)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('NO_SESSION')
    })

    it('returns 403 ROLE_FORBIDDEN for student role', async () => {
      const student = await createStudent()
      const { cookie } = await loginAs(student)
      const res = await api()
        .get(`${BASE}/00000000-0000-0000-0000-000000000000`)
        .set(cookieHeader(cookie))
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // =========================================================================
  // POST /quizzes — create quiz
  // =========================================================================
  describe('POST /quizzes', () => {
    it('creates a quiz with default lock_mode and returns 201', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({
          lecture_id: lecture.id,
          title: 'Midterm Quiz',
          description: 'Covers chapters 1-5',
        })

      expect(res.status).toBe(201)
      expect(res.body.data.quiz).toMatchObject({
        title: 'Midterm Quiz',
        description: 'Covers chapters 1-5',
        lockMode: 'after_submission',
        allowMultipleAttempts: false,
      })
    })

    it('creates a quiz with calendar lock_mode + lock_until', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const lockUntil = new Date(Date.now() + 86400000).toISOString()

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({
          lecture_id: lecture.id,
          title: 'Final Exam',
          lock_mode: 'calendar',
          lock_until: lockUntil,
          allow_multiple_attempts: true,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.quiz).toMatchObject({
        title: 'Final Exam',
        lockMode: 'calendar',
        allowMultipleAttempts: true,
      })
      expect(res.body.data.quiz.lockUntil).toBeTruthy()
    })

    it('returns 400 VALIDATION_ERROR — calendar lock_mode without lock_until', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({
          lecture_id: lecture.id,
          title: 'Bad Quiz',
          lock_mode: 'calendar',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 LECTURE_NOT_FOUND — lecture not owned by caller', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)

      const res = await api()
        .post(BASE)
        .set(cookieHeader(cookie))
        .send({
          lecture_id: lecture.id,
          title: 'Stolen Quiz',
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LECTURE_NOT_FOUND')
    })
  })

  // =========================================================================
  // GET /quizzes/:id — get quiz with questions
  // =========================================================================
  describe('GET /quizzes/:id', () => {
    it('returns quiz with questions (including correct_option_label)', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id, { title: 'My Quiz' })
      await createQuestion(quiz.id, { position: 1 })
      await createTrueFalseQuestion(quiz.id, { position: 2 })

      const res = await api()
        .get(`${BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.quiz.title).toBe('My Quiz')
      expect(res.body.data.questions).toHaveLength(2)
      // Teacher view includes correct_option_label
      expect(res.body.data.questions[0].correctOptionLabel).toBeTruthy()
    })

    it('returns questions ordered by position', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)
      await createQuestion(quiz.id, { position: 3 })
      await createQuestion(quiz.id, { position: 1 })
      await createQuestion(quiz.id, { position: 2 })

      const res = await api()
        .get(`${BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      const positions = res.body.data.questions.map((q: { position: number }) => q.position)
      expect(positions).toEqual([1, 2, 3])
    })

    it('returns 404 QUIZ_NOT_FOUND — quiz belongs to another teacher', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lectureA = await createLecture(teacherA.id)
      const quiz = await createQuiz(lectureA.id)

      const res = await api()
        .get(`${BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUIZ_NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR — non-uuid id', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .get(`${BASE}/not-a-uuid`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // =========================================================================
  // PATCH /quizzes/:id — update quiz
  // =========================================================================
  describe('PATCH /quizzes/:id', () => {
    it('partially updates supplied fields and returns 200', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id, { title: 'Old Title' })

      const res = await api()
        .patch(`${BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))
        .send({ title: 'New Title', allow_multiple_attempts: true })

      expect(res.status).toBe(200)
      expect(res.body.data.quiz.title).toBe('New Title')
      expect(res.body.data.quiz.allowMultipleAttempts).toBe(true)
      // Unchanged fields remain the same
      expect(res.body.data.quiz.lockMode).toBe('after_submission')
    })

    it('returns 400 VALIDATION_ERROR — empty body', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)

      const res = await api()
        .patch(`${BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 QUIZ_NOT_FOUND — not owned', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lectureA = await createLecture(teacherA.id)
      const quiz = await createQuiz(lectureA.id)

      const res = await api()
        .patch(`${BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))
        .send({ title: 'Hacked' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUIZ_NOT_FOUND')
    })
  })

  // =========================================================================
  // POST /quizzes/:id/questions — add question
  // =========================================================================
  describe('POST /quizzes/:id/questions', () => {
    it('adds an mcq question with options + correct label', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)

      const res = await api()
        .post(`${BASE}/${quiz.id}/questions`)
        .set(cookieHeader(cookie))
        .send({
          question_text: 'What is 2+2?',
          question_type: 'mcq',
          options: { A: '3', B: '4', C: '5', D: '6' },
          correct_option_label: 'B',
          position: 1,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.question).toMatchObject({
        questionText: 'What is 2+2?',
        questionType: 'mcq',
        correctOptionLabel: 'B',
        position: 1,
      })
      expect(res.body.data.question.options).toEqual({
        A: '3',
        B: '4',
        C: '5',
        D: '6',
      })
    })

    it('adds a true_false question', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)

      const res = await api()
        .post(`${BASE}/${quiz.id}/questions`)
        .set(cookieHeader(cookie))
        .send({
          question_text: 'The earth is round.',
          question_type: 'true_false',
          correct_option_label: 'A',
          position: 1,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.question).toMatchObject({
        questionText: 'The earth is round.',
        questionType: 'true_false',
        correctOptionLabel: 'A',
      })
    })

    it('adds a written question (no options/label)', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)

      const res = await api()
        .post(`${BASE}/${quiz.id}/questions`)
        .set(cookieHeader(cookie))
        .send({
          question_text: 'Explain photosynthesis.',
          question_type: 'written',
          points: 5,
          position: 1,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.question).toMatchObject({
        questionText: 'Explain photosynthesis.',
        questionType: 'written',
        correctOptionLabel: null,
        options: null,
      })
    })

    it('returns 409 POSITION_TAKEN — duplicate position', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)
      await createQuestion(quiz.id, { position: 1 })

      const res = await api()
        .post(`${BASE}/${quiz.id}/questions`)
        .set(cookieHeader(cookie))
        .send({
          question_text: 'Duplicate position question',
          question_type: 'mcq',
          options: { A: 'x', B: 'y' },
          correct_option_label: 'A',
          position: 1,
        })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('POSITION_TAKEN')
    })

    it('returns 404 QUIZ_NOT_FOUND — not owned', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lectureA = await createLecture(teacherA.id)
      const quiz = await createQuiz(lectureA.id)

      const res = await api()
        .post(`${BASE}/${quiz.id}/questions`)
        .set(cookieHeader(cookie))
        .send({
          question_text: 'Foreign question',
          question_type: 'written',
          position: 1,
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUIZ_NOT_FOUND')
    })
  })

  // =========================================================================
  // PATCH /quizzes/:id/questions/:qid — edit question
  // =========================================================================
  describe('PATCH /quizzes/:id/questions/:qid', () => {
    it('edits question text and returns 200', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)
      const question = await createQuestion(quiz.id)

      const res = await api()
        .patch(`${BASE}/${quiz.id}/questions/${question.id}`)
        .set(cookieHeader(cookie))
        .send({
          question_type: 'mcq',
          question_text: 'Updated question text',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.question.questionText).toBe('Updated question text')
      // Unchanged fields remain
      expect(res.body.data.question.correctOptionLabel).toBe('B')
    })

    it('returns 404 QUESTION_NOT_FOUND — question not in this quiz', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz1 = await createQuiz(lecture.id)
      const quiz2 = await createQuiz(lecture.id)
      const question = await createQuestion(quiz1.id)

      const res = await api()
        .patch(`${BASE}/${quiz2.id}/questions/${question.id}`)
        .set(cookieHeader(cookie))
        .send({
          question_type: 'mcq',
          question_text: 'Wrong quiz',
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUESTION_NOT_FOUND')
    })

    it('returns 404 QUIZ_NOT_FOUND — not owned', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lectureA = await createLecture(teacherA.id)
      const quiz = await createQuiz(lectureA.id)
      const question = await createQuestion(quiz.id)

      const res = await api()
        .patch(`${BASE}/${quiz.id}/questions/${question.id}`)
        .set(cookieHeader(cookie))
        .send({
          question_type: 'mcq',
          question_text: 'Hack attempt',
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUIZ_NOT_FOUND')
    })
  })

  // =========================================================================
  // DELETE /quizzes/:id/questions/:qid — delete question
  // =========================================================================
  describe('DELETE /quizzes/:id/questions/:qid', () => {
    it('deletes a question and returns 200', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)
      const question = await createQuestion(quiz.id)

      const res = await api()
        .delete(`${BASE}/${quiz.id}/questions/${question.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.question.id).toBe(question.id)
    })

    it('returns 404 QUESTION_NOT_FOUND — not owned / missing', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lectureA = await createLecture(teacherA.id)
      const quiz = await createQuiz(lectureA.id)
      const question = await createQuestion(quiz.id)

      const res = await api()
        .delete(`${BASE}/${quiz.id}/questions/${question.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUESTION_NOT_FOUND')
    })
  })
})

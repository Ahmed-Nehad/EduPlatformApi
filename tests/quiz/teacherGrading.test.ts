import { describe, it, expect, afterEach } from 'vitest'
import { api, resetAuthState, loginAs, cookieHeader } from '../helpers/app.ts'
import {
  createAdmin,
  createTeacher,
  createStudent,
  createLecture,
  createQuiz,
  createQuestion,
  createTrueFalseQuestion,
  createWrittenQuestion,
  createContentItem,
  createTeacherAccessRequest,
  createWalletTransaction,
  createLecturePurchase,
  createQuizAttempt,
  createQuizAnswer,
} from '../helpers/factories.ts'

const TEACHER_BASE = '/v1/teacher'
const QUIZ_BASE = '/v1/quizzes'

/** Creates admin + teacher + student (approved), published lecture, quiz,
 *  MCQ + written questions, wallet credit, purchase, and a submitted attempt
 *  with ungraded written answers.
 */
async function setupGradingScenario() {
  const admin = await createAdmin()
  const teacher = await createTeacher(admin.id)
  const student = await createStudent()

  await createTeacherAccessRequest({
    studentId: student.id,
    teacherId: teacher.id,
    status: 'approved',
  })

  const lecture = await createLecture(teacher.id, { status: 'published', price: 50 })
  const quiz = await createQuiz(lecture.id)

  await createContentItem({
    lectureId: lecture.id,
    contentType: 'quiz',
    contentId: quiz.id,
    position: 1,
  })

  const walletTx = await createWalletTransaction(student.id, teacher.id, {
    type: 'credit_code',
    amount: 200,
    balanceAfter: 200,
  })
  await createLecturePurchase({
    studentId: student.id,
    lectureId: lecture.id,
    walletTransactionId: walletTx.id,
  })

  const mcq = await createQuestion(quiz.id, {
    position: 1,
    correctOptionLabel: 'B',
    points: 1,
  })
  const written = await createWrittenQuestion(quiz.id, {
    position: 2,
    points: 5,
  })

  // Create submitted attempt with MCQ answer auto-graded, written ungraded.
  const attempt = await createQuizAttempt(quiz.id, student.id, {
    status: 'submitted',
    submittedAt: new Date(),
  })
  await createQuizAnswer(attempt.id, mcq.id, {
    selectedLabel: 'B',
    isCorrect: true,
    pointsAwarded: 1,
  })
  await createQuizAnswer(attempt.id, written.id, {
    writtenAnswerText: 'My essay answer',
  })

  return { admin, teacher, student, lecture, quiz, mcq, written, attempt }
}

describe('teacher grading routes', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // =========================================================================
  // GET /teacher/quiz-attempts — Ungraded Queue
  // =========================================================================
  describe('GET /teacher/quiz-attempts', () => {
    it('returns attempts with ungraded written answers', async () => {
      const { teacher, attempt } = await setupGradingScenario()
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .get(`${TEACHER_BASE}/quiz-attempts?needs_grading=true`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.attempts).toHaveLength(1)
      expect(res.body.data.attempts[0].id).toBe(attempt.id)
    })

    it('returns empty list when all attempts fully graded', async () => {
      const { teacher, attempt, written } = await setupGradingScenario()
      // Update the existing ungraded written answer to be graded (pointsAwarded set).
      const { db } = await import('../../src/db/connection.ts')
      const { quizAnswers } = await import('../../src/db/schema.ts')
      const { eq, and } = await import('drizzle-orm')
      await db
        .update(quizAnswers)
        .set({ pointsAwarded: '5', gradedAt: new Date() })
        .where(
          and(
            eq(quizAnswers.attemptId, attempt.id),
            eq(quizAnswers.questionId, written.id)
          )
        )

      const { cookie } = await loginAs(teacher)

      const res = await api()
        .get(`${TEACHER_BASE}/quiz-attempts?needs_grading=true`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.attempts).toHaveLength(0)
    })

    it('returns 403 ROLE_FORBIDDEN — student cannot access', async () => {
      const { student } = await setupGradingScenario()
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${TEACHER_BASE}/quiz-attempts`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ROLE_FORBIDDEN')
    })
  })

  // =========================================================================
  // POST /teacher/quiz-attempts/:id/grade — Grade Attempt
  // =========================================================================
  describe('POST /teacher/quiz-attempts/:id/grade', () => {
    it('grades written answer, sets points and feedback', async () => {
      const { teacher, attempt, written } = await setupGradingScenario()
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${TEACHER_BASE}/quiz-attempts/${attempt.id}/grade`)
        .set(cookieHeader(cookie))
        .send({
          grades: [
            {
              question_id: written.id,
              points_awarded: 4,
              teacher_feedback: 'Good effort',
            },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('final grading — computes score, sets gradedAt', async () => {
      const { teacher, attempt, written } = await setupGradingScenario()
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${TEACHER_BASE}/quiz-attempts/${attempt.id}/grade`)
        .set(cookieHeader(cookie))
        .send({
          grades: [
            {
              question_id: written.id,
              points_awarded: 5,
            },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.gradedAt).toBeTruthy()
    })

    it('returns 400 POINTS_EXCEED_MAX — points > question max', async () => {
      const { teacher, attempt, written } = await setupGradingScenario()
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${TEACHER_BASE}/quiz-attempts/${attempt.id}/grade`)
        .set(cookieHeader(cookie))
        .send({
          grades: [
            {
              question_id: written.id,
              points_awarded: 100,
            },
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('POINTS_EXCEED_MAX')
    })

    it('returns 400 INVALID_GRADE_ENTRY — attempting to grade MCQ', async () => {
      const { teacher, attempt, mcq } = await setupGradingScenario()
      const { cookie } = await loginAs(teacher)

      const res = await api()
        .post(`${TEACHER_BASE}/quiz-attempts/${attempt.id}/grade`)
        .set(cookieHeader(cookie))
        .send({
          grades: [
            {
              question_id: mcq.id,
              points_awarded: 1,
            },
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_GRADE_ENTRY')
    })

    it('returns 404 ATTEMPT_NOT_FOUND — attempt belongs to another teacher', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacherA.id,
        status: 'approved',
      })
      const lecture = await createLecture(teacherA.id, { status: 'published', price: 0 })
      const quiz = await createQuiz(lecture.id)
      const written = await createWrittenQuestion(quiz.id, { position: 1, points: 5 })
      const walletTx = await createWalletTransaction(student.id, teacherA.id, {
        type: 'credit_code',
        amount: 100,
        balanceAfter: 100,
      })
      await createLecturePurchase({
        studentId: student.id,
        lectureId: lecture.id,
        walletTransactionId: walletTx.id,
      })
      const attempt = await createQuizAttempt(quiz.id, student.id, {
        status: 'submitted',
      })
      await createQuizAnswer(attempt.id, written.id)

      const { cookie } = await loginAs(teacherB)

      const res = await api()
        .post(`${TEACHER_BASE}/quiz-attempts/${attempt.id}/grade`)
        .set(cookieHeader(cookie))
        .send({
          grades: [
            {
              question_id: written.id,
              points_awarded: 5,
            },
          ],
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND')
    })
  })

  // =========================================================================
  // PATCH /quizzes/:id/questions/reorder — Reorder Questions
  // =========================================================================
  describe('PATCH /quizzes/:id/questions/reorder', () => {
    it('reorders questions to new positions', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)
      const q1 = await createQuestion(quiz.id, { position: 1 })
      const q2 = await createQuestion(quiz.id, { position: 2 })
      const q3 = await createQuestion(quiz.id, { position: 3 })

      const res = await api()
        .patch(`${QUIZ_BASE}/${quiz.id}/questions/reorder`)
        .set(cookieHeader(cookie))
        .send({ ordered_ids: [q3.id, q1.id, q2.id] })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify new order.
      const getRes = await api()
        .get(`${QUIZ_BASE}/${quiz.id}`)
        .set(cookieHeader(cookie))
      const positions = getRes.body.data.questions.map(
        (q: { id: string; position: number }) => ({ id: q.id, position: q.position })
      )
      expect(positions).toEqual([
        { id: q3.id, position: 1 },
        { id: q1.id, position: 2 },
        { id: q2.id, position: 3 },
      ])
    })

    it('returns 400 INVALID_QUESTION_SET — ordered_ids mismatch', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacher)
      const lecture = await createLecture(teacher.id)
      const quiz = await createQuiz(lecture.id)
      const q1 = await createQuestion(quiz.id, { position: 1 })
      const q2 = await createQuestion(quiz.id, { position: 2 })

      const res = await api()
        .patch(`${QUIZ_BASE}/${quiz.id}/questions/reorder`)
        .set(cookieHeader(cookie))
        .send({ ordered_ids: [q1.id] }) // missing q2

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_QUESTION_SET')
    })

    it('returns 404 QUIZ_NOT_FOUND — quiz not owned by caller', async () => {
      const admin = await createAdmin()
      const teacherA = await createTeacher(admin.id)
      const teacherB = await createTeacher(admin.id)
      const { cookie } = await loginAs(teacherB)
      const lecture = await createLecture(teacherA.id)
      const quiz = await createQuiz(lecture.id)
      const q1 = await createQuestion(quiz.id, { position: 1 })

      const res = await api()
        .patch(`${QUIZ_BASE}/${quiz.id}/questions/reorder`)
        .set(cookieHeader(cookie))
        .send({ ordered_ids: [q1.id] })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUIZ_NOT_FOUND')
    })
  })
})

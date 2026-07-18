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

const BASE = '/v1/student'

/** Creates the full prerequisite chain: admin → teacher → student (approved),
 *  published lecture, content item, wallet credit, purchase, quiz + questions.
 */
async function setupQuizWithStudent(overrides?: {
  lockMode?: 'calendar' | 'after_submission'
  lockUntil?: Date | null
  allowMultipleAttempts?: boolean
}) {
  const admin = await createAdmin()
  const teacher = await createTeacher(admin.id)
  const student = await createStudent()

  // Approve student access.
  await createTeacherAccessRequest({
    studentId: student.id,
    teacherId: teacher.id,
    status: 'approved',
  })

  // Published lecture with price.
  const lecture = await createLecture(teacher.id, {
    status: 'published',
    price: 50,
  })

  // Quiz attached to lecture.
  const quiz = await createQuiz(lecture.id, {
    lockMode: overrides?.lockMode ?? 'after_submission',
    lockUntil: overrides?.lockUntil ?? null,
    allowMultipleAttempts: overrides?.allowMultipleAttempts ?? false,
  })

  // Content item linking quiz to lecture.
  await createContentItem({
    lectureId: lecture.id,
    contentType: 'quiz',
    contentId: quiz.id,
    position: 1,
  })

  // Wallet credit + purchase.
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

  // Questions.
  const mcq = await createQuestion(quiz.id, {
    position: 1,
    correctOptionLabel: 'B',
    options: { A: '3', B: '4', C: '5', D: '6' },
  })
  const tf = await createTrueFalseQuestion(quiz.id, {
    position: 2,
    correctOptionLabel: 'A',
  })
  const written = await createWrittenQuestion(quiz.id, {
    position: 3,
    points: 5,
  })

  return { admin, teacher, student, lecture, quiz, mcq, tf, written }
}

describe('student quiz attempts', () => {
  afterEach(async () => {
    await resetAuthState()
  })

  // =========================================================================
  // GET /student/quizzes/:id — Quiz Landing Page
  // =========================================================================
  describe('GET /student/quizzes/:id', () => {
    it('returns quiz metadata, question count, empty attempts', async () => {
      const { student, quiz, mcq, tf, written } = await setupQuizWithStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quizzes/${quiz.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.quiz.title).toBe('Test Quiz')
      expect(res.body.data.questionCount).toBe(3)
      expect(res.body.data.attempts).toEqual([])
    })

    it('returns existing attempt summaries', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      await createQuizAttempt(quiz.id, student.id, {
        attemptNumber: 1,
        status: 'submitted',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quizzes/${quiz.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.attempts).toHaveLength(1)
      expect(res.body.data.attempts[0]).toMatchObject({
        attemptNumber: 1,
        status: 'submitted',
      })
    })

    it('returns 403 LECTURE_NOT_PURCHASED — student has not bought lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const lecture = await createLecture(teacher.id, { status: 'published' })
      const quiz = await createQuiz(lecture.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quizzes/${quiz.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('LECTURE_NOT_PURCHASED')
    })

    it('returns 404 QUIZ_NOT_FOUND — quiz does not exist', async () => {
      const { student } = await setupQuizWithStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quizzes/00000000-0000-0000-0000-000000000000`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('QUIZ_NOT_FOUND')
    })
  })

  // =========================================================================
  // POST /student/quizzes/:id/attempts — Start Attempt
  // =========================================================================
  describe('POST /student/quizzes/:id/attempts', () => {
    it('creates attempt with attemptNumber=1, status=in_progress', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quizzes/${quiz.id}/attempts`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(201)
      expect(res.body.data.attempt).toMatchObject({
        attemptNumber: 1,
        status: 'in_progress',
      })
      expect(res.body.data.attempt.id).toBeTruthy()
    })

    it('creates attemptNumber=2 when allow_multiple_attempts=true', async () => {
      const { student, quiz, mcq } = await setupQuizWithStudent({
        allowMultipleAttempts: true,
      })
      const { cookie } = await loginAs(student)

      // First attempt.
      const firstRes = await api()
        .post(`${BASE}/quizzes/${quiz.id}/attempts`)
        .set(cookieHeader(cookie))
      const firstAttemptId = firstRes.body.data.attempt.id

      // Submit first attempt.
      await api()
        .post(`${BASE}/quiz-attempts/${firstAttemptId}/submit`)
        .set(cookieHeader(cookie))
        .send({
          answers: [{ question_id: mcq.id, selected_label: 'B' }],
        })

      // Second attempt.
      const res = await api()
        .post(`${BASE}/quizzes/${quiz.id}/attempts`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(201)
      expect(res.body.data.attempt.attemptNumber).toBe(2)
    })

    it('returns 403 MAX_ATTEMPTS_REACHED — single attempt, prior exists', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      await createQuizAttempt(quiz.id, student.id, { status: 'submitted' })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quizzes/${quiz.id}/attempts`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('MAX_ATTEMPTS_REACHED')
    })

    it('returns 403 QUIZ_LOCKED — lock_until in the past', async () => {
      const pastDate = new Date(Date.now() - 86400000)
      const { student, quiz } = await setupQuizWithStudent({
        lockMode: 'calendar',
        lockUntil: pastDate,
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quizzes/${quiz.id}/attempts`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('QUIZ_LOCKED')
    })

    it('returns 403 LECTURE_NOT_PURCHASED — student has not bought lecture', async () => {
      const admin = await createAdmin()
      const teacher = await createTeacher(admin.id)
      const student = await createStudent()
      await createTeacherAccessRequest({
        studentId: student.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const lecture = await createLecture(teacher.id, { status: 'published' })
      const quiz = await createQuiz(lecture.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quizzes/${quiz.id}/attempts`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('LECTURE_NOT_PURCHASED')
    })
  })

  // =========================================================================
  // GET /student/quiz-attempts/:id — In-Progress View
  // =========================================================================
  describe('GET /student/quiz-attempts/:id', () => {
    it('returns questions (no correct_option_label) + saved answers', async () => {
      const { student, quiz, mcq } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id)
      await createQuizAnswer(attempt.id, mcq.id, { selectedLabel: 'B' })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.questions).toHaveLength(3)
      // No correct_option_label in student view.
      expect(res.body.data.questions[0].correctOptionLabel).toBeUndefined()
      expect(res.body.data.answers).toHaveLength(1)
      expect(res.body.data.answers[0].selectedLabel).toBe('B')
    })

    it('returns empty answers for fresh attempt', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.answers).toEqual([])
    })

    it('returns 403 ATTEMPT_NOT_IN_PROGRESS — already submitted', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id, {
        status: 'submitted',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS')
    })

    it('returns 404 ATTEMPT_NOT_FOUND — attempt belongs to another student', async () => {
      const { student, teacher, quiz } = await setupQuizWithStudent()
      const otherStudent = await createStudent()
      await createTeacherAccessRequest({
        studentId: otherStudent.id,
        teacherId: teacher.id,
        status: 'approved',
      })
      const attempt = await createQuizAttempt(quiz.id, otherStudent.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND')
    })
  })

  // =========================================================================
  // POST /student/quiz-attempts/:id/submit — Submit Attempt
  // =========================================================================
  describe('POST /student/quiz-attempts/:id/submit', () => {
    it('submits, auto-grades MCQ/TF, leaves written ungraded', async () => {
      const { student, quiz, mcq, tf, written } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quiz-attempts/${attempt.id}/submit`)
        .set(cookieHeader(cookie))
        .send({
          answers: [
            { question_id: mcq.id, selected_label: 'B' },
            { question_id: tf.id, selected_label: 'A' },
            { question_id: written.id, written_answer_text: 'My answer' },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('submitted')
    })

    it('all MCQ/TF → score computed, gradedAt set (fully auto-graded)', async () => {
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
        points: 2,
      })
      const tf = await createTrueFalseQuestion(quiz.id, {
        position: 2,
        correctOptionLabel: 'A',
        points: 3,
      })

      const attempt = await createQuizAttempt(quiz.id, student.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quiz-attempts/${attempt.id}/submit`)
        .set(cookieHeader(cookie))
        .send({
          answers: [
            { question_id: mcq.id, selected_label: 'B' },
            { question_id: tf.id, selected_label: 'A' },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('submitted')
      expect(res.body.data.submittedAt).toBeTruthy()
    })

    it('returns 403 ATTEMPT_NOT_IN_PROGRESS — cannot submit twice', async () => {
      const { student, quiz, mcq } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id, {
        status: 'submitted',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quiz-attempts/${attempt.id}/submit`)
        .set(cookieHeader(cookie))
        .send({
          answers: [{ question_id: mcq.id, selected_label: 'B' }],
        })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS')
    })

    it('returns 403 QUIZ_LOCKED — lock expired before submission', async () => {
      const pastDate = new Date(Date.now() - 86400000)
      const { student, quiz, mcq } = await setupQuizWithStudent({
        lockMode: 'calendar',
        lockUntil: pastDate,
      })
      const attempt = await createQuizAttempt(quiz.id, student.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quiz-attempts/${attempt.id}/submit`)
        .set(cookieHeader(cookie))
        .send({
          answers: [{ question_id: mcq.id, selected_label: 'B' }],
        })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('QUIZ_LOCKED')
    })

    it('returns 400 — answer references question not in this quiz', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      const otherQuiz = await createQuiz(
        (await createLecture(
          (await createTeacher((await createAdmin()).id)).id,
          { status: 'published' }
        )).id
      )
      const otherQuestion = await createQuestion(otherQuiz.id)
      const attempt = await createQuizAttempt(quiz.id, student.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .post(`${BASE}/quiz-attempts/${attempt.id}/submit`)
        .set(cookieHeader(cookie))
        .send({
          answers: [{ question_id: otherQuestion.id, selected_label: 'A' }],
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_QUESTION')
    })
  })

  // =========================================================================
  // GET /student/quiz-attempts/:id/results — Results
  // =========================================================================
  describe('GET /student/quiz-attempts/:id/results', () => {
    it('returns full results after grading', async () => {
      const { student, quiz, mcq, tf, written } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id, {
        status: 'submitted',
        gradedAt: new Date(),
        score: 7,
      })
      await createQuizAnswer(attempt.id, mcq.id, {
        selectedLabel: 'B',
        isCorrect: true,
        pointsAwarded: 1,
      })
      await createQuizAnswer(attempt.id, tf.id, {
        selectedLabel: 'A',
        isCorrect: true,
        pointsAwarded: 1,
      })
      await createQuizAnswer(attempt.id, written.id, {
        writtenAnswerText: 'My answer',
        pointsAwarded: 5,
        teacherFeedback: 'Good work',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}/results`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(200)
      expect(res.body.data.attempt.score).toBe(7)
      expect(res.body.data.questions).toHaveLength(3)
      expect(res.body.data.questions[0].studentAnswer.isCorrect).toBe(true)
    })

    it('returns 403 NOT_YET_GRADED — submitted but written not graded', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id, {
        status: 'submitted',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}/results`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('NOT_YET_GRADED')
    })

    it('returns 403 RESULTS_LOCKED — lock period still active', async () => {
      const futureDate = new Date(Date.now() + 86400000)
      const { student, quiz } = await setupQuizWithStudent({
        lockMode: 'calendar',
        lockUntil: futureDate,
      })
      const attempt = await createQuizAttempt(quiz.id, student.id, {
        status: 'submitted',
      })
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}/results`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('RESULTS_LOCKED')
    })

    it('returns 403 ATTEMPT_NOT_SUBMITTED — still in progress', async () => {
      const { student, quiz } = await setupQuizWithStudent()
      const attempt = await createQuizAttempt(quiz.id, student.id)
      const { cookie } = await loginAs(student)

      const res = await api()
        .get(`${BASE}/quiz-attempts/${attempt.id}/results`)
        .set(cookieHeader(cookie))

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ATTEMPT_NOT_SUBMITTED')
    })
  })
})

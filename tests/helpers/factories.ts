import { db } from '../../src/db/connection.ts'
import {
  students,
  teachers,
  admins,
  teacherAccessRequests,
  lectures,
  videos,
  files,
  quizzes,
  quizQuestions,
  quizAttempts,
  quizAnswers,
  lectureContentItems,
  walletTransactions,
  redemptionCodes,
  codeRedemptions,
  lecturePurchases,
} from '../../src/db/schema.ts'
import { hashPassword } from '../../src/utils/password.ts'

export interface TestUser {
  id: string
  name: string
  email: string
  role: 'student' | 'teacher' | 'admin'
  password: string
}

let counter = 0
/** Unique email per call to avoid collisions across tests. */
const uniqueEmail = (prefix: string) =>
  `${prefix}+${Date.now()}_${counter++}@test.edu`

export async function createStudent(
  overrides: Partial<{
    name: string
    email: string
    password: string
    isActive: boolean
    emailVerified: boolean
  }> = {}
): Promise<TestUser> {
  const password = overrides.password ?? 'Password123!'
  const passwordHash = await hashPassword(password)
  const email = overrides.email ?? uniqueEmail('student')
  const [row] = await db
    .insert(students)
    .values({
      name: overrides.name ?? 'Test Student',
      email,
      passwordHash,
      isActive: overrides.isActive ?? true,
      // Students are verified by default so existing login tests keep passing.
      // Tests that exercise the verification gate pass `emailVerified: false`.
      emailVerifiedAt:
        (overrides.emailVerified ?? true) ? new Date() : null,
    })
    .returning({ id: students.id, name: students.name, email: students.email })

  return { ...row, role: 'student', password }
}

export async function createTeacher(
  adminId: string,
  overrides: Partial<{ name: string; email: string; password: string; isActive: boolean }> = {}
): Promise<TestUser> {
  const password = overrides.password ?? 'Password123!'
  const passwordHash = await hashPassword(password)
  const email = overrides.email ?? uniqueEmail('teacher')
  const [row] = await db
    .insert(teachers)
    .values({
      name: overrides.name ?? 'Test Teacher',
      email,
      passwordHash,
      isActive: overrides.isActive ?? true,
      createdByAdminId: adminId,
    })
    .returning({ id: teachers.id, name: teachers.name, email: teachers.email })

  return { ...row, role: 'teacher', password }
}

export async function createAdmin(
  overrides: Partial<{ name: string; email: string; password: string }> = {}
): Promise<TestUser> {
  const password = overrides.password ?? 'Password123!'
  const passwordHash = await hashPassword(password)
  const email = overrides.email ?? uniqueEmail('admin')
  const [row] = await db
    .insert(admins)
    .values({
      name: overrides.name ?? 'Test Admin',
      email,
      passwordHash,
    })
    .returning({ id: admins.id, name: admins.name, email: admins.email })

  return { ...row, role: 'admin', password }
}

/** A valid device fingerprint string in the `sha256:<hex>` format. */
export const fingerprint = (seed: string) =>
  `sha256:${seed.padEnd(8, '0').slice(0, 64)}`


/**
 * Creates a teacher access request row in the database (for test purposes).
 * Returns the inserted row.
 */
export async function createTeacherAccessRequest(
  args: {
    studentId: string
    teacherId: string
    status?: 'pending' | 'approved' | 'rejected'
    requestedAt?: Date
    decidedAt?: Date | null
  }
) {
  const result = await db
    .insert(teacherAccessRequests)
    .values({
      studentId: args.studentId,
      teacherId: args.teacherId,
      status: args.status ?? 'pending',
      requestedAt: args.requestedAt ?? new Date(),
      decidedAt: args.decidedAt ?? null,
    })
    .returning()
  return result[0]
}

// ---------------------------------------------------------------------------
// Lectures & content factories
// ---------------------------------------------------------------------------

/**
 * Creates a lecture owned by `teacherId`. Defaults to `status = 'draft'` and a
 * price of 0; pass overrides to publish it or set a price.
 */
export async function createLecture(
  teacherId: string,
  overrides: Partial<{
    title: string
    description: string | null
    price: number
    thumbnailR2Key: string | null
    status: 'draft' | 'published'
    expiresAt: Date
    deletedAt: Date | null
  }> = {}
) {
  const [row] = await db
    .insert(lectures)
    .values({
      teacherId,
      title: overrides.title ?? 'Test Lecture',
      description: overrides.description ?? null,
      price: (overrides.price ?? 0).toString(),
      thumbnailR2Key: overrides.thumbnailR2Key ?? null,
      status: overrides.status ?? 'draft',
      ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
      ...(overrides.deletedAt ? { deletedAt: overrides.deletedAt } : {}),
    })
    .returning()
  return row
}

/** Creates a video row attached to a lecture. */
export async function createVideo(
  lectureId: string,
  overrides: Partial<{
    title: string
    description: string | null
    vdocipherVideoId: string
    durationSeconds: number
    sizeBytes: number
    status: 'processing' | 'ready' | 'failed' | 'expired'
    deletedAt: Date | null
  }> = {}
) {
  const [row] = await db
    .insert(videos)
    .values({
      lectureId,
      vdocipherVideoId: overrides.vdocipherVideoId ?? `vdo_${Date.now()}`,
      title: overrides.title ?? 'Test Video',
      description: overrides.description ?? null,
      durationSeconds: overrides.durationSeconds ?? 900,
      sizeBytes: overrides.sizeBytes ?? 157286400,
      status: overrides.status ?? 'ready',
      ...(overrides.deletedAt ? { deletedAt: overrides.deletedAt } : {}),
    })
    .returning()
  return row
}

/** Creates a file row attached to a lecture. */
export async function createFile(
  lectureId: string,
  overrides: Partial<{
    title: string
    description: string | null
    r2ObjectKey: string
    sizeBytes: number
    deletedAt: Date | null
  }> = {}
) {
  const [row] = await db
    .insert(files)
    .values({
      lectureId,
      r2ObjectKey: overrides.r2ObjectKey ?? `lectures/${lectureId}/file.pdf`,
      title: overrides.title ?? 'Test File',
      description: overrides.description ?? null,
      sizeBytes: overrides.sizeBytes ?? 5242880,
      ...(overrides.deletedAt ? { deletedAt: overrides.deletedAt } : {}),
    })
    .returning()
  return row
}

/** Creates a quiz row attached to a lecture. */
export async function createQuiz(
  lectureId: string,
  overrides: Partial<{
    title: string
    description: string | null
    lockMode: 'calendar' | 'after_submission'
    lockUntil: Date | null
    allowMultipleAttempts: boolean
  }> = {}
) {
  const [row] = await db
    .insert(quizzes)
    .values({
      lectureId,
      title: overrides.title ?? 'Test Quiz',
      description: overrides.description ?? null,
      lockMode: overrides.lockMode ?? 'after_submission',
      lockUntil: overrides.lockUntil ?? null,
      allowMultipleAttempts: overrides.allowMultipleAttempts ?? false,
    })
    .returning()
  return row
}

/**
 * Creates a `lecture_content_items` row linking a content row to a lecture at
 * a given position.
 */
export async function createContentItem(args: {
  lectureId: string
  contentType: 'video' | 'file' | 'quiz'
  contentId: string
  position: number
}) {
  const [row] = await db
    .insert(lectureContentItems)
    .values({
      lectureId: args.lectureId,
      contentType: args.contentType,
      contentId: args.contentId,
      position: args.position,
    })
    .returning()
  return row
}

// ---------------------------------------------------------------------------
// Quiz question factories
// ---------------------------------------------------------------------------

/** Creates an MCQ question attached to a quiz. */
export async function createQuestion(
  quizId: string,
  overrides: Partial<{
    questionText: string
    options: Record<string, string>
    correctOptionLabel: 'A' | 'B' | 'C' | 'D'
    points: number
    imageR2Key: string | null
    position: number
  }> = {}
) {
  const [row] = await db
    .insert(quizQuestions)
    .values({
      quizId,
      questionText: overrides.questionText ?? 'What is 2+2?',
      questionType: 'mcq',
      options: overrides.options ?? { A: '3', B: '4', C: '5', D: '6' },
      correctOptionLabel: overrides.correctOptionLabel ?? 'B',
      points: (overrides.points ?? 1).toString(),
      imageR2Key: overrides.imageR2Key ?? null,
      position: overrides.position ?? 1,
    })
    .returning()
  return row
}

/** Creates a true/false question attached to a quiz. */
export async function createTrueFalseQuestion(
  quizId: string,
  overrides: Partial<{
    questionText: string
    correctOptionLabel: 'A' | 'B'
    points: number
    imageR2Key: string | null
    position: number
  }> = {}
) {
  const [row] = await db
    .insert(quizQuestions)
    .values({
      quizId,
      questionText: overrides.questionText ?? 'The sky is blue.',
      questionType: 'true_false',
      correctOptionLabel: overrides.correctOptionLabel ?? 'A',
      points: (overrides.points ?? 1).toString(),
      imageR2Key: overrides.imageR2Key ?? null,
      position: overrides.position ?? 1,
    })
    .returning()
  return row
}

/** Creates a written (essay) question attached to a quiz. */
export async function createWrittenQuestion(
  quizId: string,
  overrides: Partial<{
    questionText: string
    points: number
    imageR2Key: string | null
    position: number
  }> = {}
) {
  const [row] = await db
    .insert(quizQuestions)
    .values({
      quizId,
      questionText: overrides.questionText ?? 'Explain your answer.',
      questionType: 'written',
      points: (overrides.points ?? 2).toString(),
      imageR2Key: overrides.imageR2Key ?? null,
      position: overrides.position ?? 1,
    })
    .returning()
  return row
}

// ---------------------------------------------------------------------------
// Quiz attempt & answer factories
// ---------------------------------------------------------------------------

/** Creates a quiz attempt row. */
export async function createQuizAttempt(
  quizId: string,
  studentId: string,
  overrides: Partial<{
    attemptNumber: number
    status: 'in_progress' | 'submitted' | 'graded'
    startedAt: Date
    submittedAt: Date | null
    gradedAt: Date | null
    score: number
  }> = {}
) {
  const [row] = await db
    .insert(quizAttempts)
    .values({
      quizId,
      studentId,
      attemptNumber: overrides.attemptNumber ?? 1,
      status: overrides.status ?? 'in_progress',
      startedAt: overrides.startedAt ?? new Date(),
      ...(overrides.submittedAt !== undefined
        ? { submittedAt: overrides.submittedAt }
        : {}),
      ...(overrides.gradedAt !== undefined
        ? { gradedAt: overrides.gradedAt }
        : {}),
      ...(overrides.score !== undefined
        ? { score: overrides.score.toString() }
        : {}),
    })
    .returning()
  return row
}

/** Creates a quiz answer row. */
export async function createQuizAnswer(
  attemptId: string,
  questionId: string,
  overrides: Partial<{
    selectedLabel: string | null
    writtenAnswerText: string | null
    isCorrect: boolean | null
    pointsAwarded: number | null
    gradedByTeacherId: string | null
    gradedAt: Date | null
    teacherFeedback: string | null
  }> = {}
) {
  const [row] = await db
    .insert(quizAnswers)
    .values({
      attemptId,
      questionId,
      selectedLabel: overrides.selectedLabel ?? null,
      writtenAnswerText: overrides.writtenAnswerText ?? null,
      isCorrect: overrides.isCorrect ?? null,
      pointsAwarded:
        overrides.pointsAwarded !== undefined
          ? overrides.pointsAwarded.toString()
          : null,
      ...(overrides.gradedByTeacherId !== undefined
        ? { gradedByTeacherId: overrides.gradedByTeacherId }
        : {}),
      ...(overrides.gradedAt !== undefined
        ? { gradedAt: overrides.gradedAt }
        : {}),
      ...(overrides.teacherFeedback !== undefined
        ? { teacherFeedback: overrides.teacherFeedback }
        : {}),
    })
    .returning()
  return row
}

// ---------------------------------------------------------------------------
// Wallet, codes & purchase factories
// ---------------------------------------------------------------------------

/** Creates a redemption code issued by a teacher. */
export async function createRedemptionCode(
  teacherId: string,
  overrides: Partial<{
    code: string
    creditAmount: number
    isActive: boolean
    expiresAt: Date | null
    deletedAt: Date | null
  }> = {}
) {
  const [row] = await db
    .insert(redemptionCodes)
    .values({
      teacherId,
      code: overrides.code ?? `CODE_${Date.now()}_${counter++}`,
      creditAmount: (overrides.creditAmount ?? 100).toString(),
      isActive: overrides.isActive ?? true,
      ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
      ...(overrides.deletedAt !== undefined ? { deletedAt: overrides.deletedAt } : {}),
    })
    .returning()
  return row
}

/** Creates a wallet transaction ledger row. */
export async function createWalletTransaction(
  studentId: string,
  teacherId: string,
  overrides: Partial<{
    type: 'credit_code' | 'credit_payment' | 'debit_purchase' | 'refund' | 'adjustment'
    amount: number
    balanceAfter: number
    referenceTable: string
    referenceId: string
    description: string
  }> = {}
) {
  const [row] = await db
    .insert(walletTransactions)
    .values({
      studentId,
      teacherId,
      type: overrides.type ?? 'credit_code',
      amount: (overrides.amount ?? 100).toString(),
      balanceAfter: (overrides.balanceAfter ?? 100).toString(),
      referenceTable: overrides.referenceTable ?? null,
      referenceId: overrides.referenceId ?? null,
      description: overrides.description ?? null,
    })
    .returning()
  return row
}

/** Creates a code redemption record. */
export async function createCodeRedemption(args: {
  codeId: string
  studentId: string
  walletTransactionId: string
}) {
  const [row] = await db
    .insert(codeRedemptions)
    .values({
      codeId: args.codeId,
      studentId: args.studentId,
      walletTransactionId: args.walletTransactionId,
    })
    .returning()
  return row
}

/** Creates a lecture purchase record. */
export async function createLecturePurchase(args: {
  studentId: string
  lectureId: string
  walletTransactionId: string
}) {
  const [row] = await db
    .insert(lecturePurchases)
    .values({
      studentId: args.studentId,
      lectureId: args.lectureId,
      walletTransactionId: args.walletTransactionId,
    })
    .returning()
  return row
}
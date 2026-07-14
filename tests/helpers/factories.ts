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
  lectureContentItems,
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